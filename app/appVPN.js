/* eslint no-console: ["error", { "allow": ["error"] }] */

'use strict';

/* node14_ready */

const fs = require('fs');
const MyIP = require('./MyIP');
const log = require('./SystemLog2');
const FBHelper = require('./FBHelper');
const DeviceMonitor = require('./DeviceMonitor');

let _config;
let _deviceMonitor;

const APP_NAME = 'VPNMonitor';

/**
 * Init
 */
async function init() {
  log.startWSS();
  log.setFileLogOpts(50, './logs/system.log');
  log.setFirebaseLogOpts(50, `logs/${APP_NAME}`);
  log.appStart(APP_NAME);

  try {
    log.log(APP_NAME, 'Reading config from Firebase...');
    const fbRootRef = await FBHelper.getRootRef(30 * 1000);
    const fbConfigRef = await fbRootRef.child(`config/${APP_NAME}`);
    _config = await fbConfigRef.once('value');
    _config = _config.val();
  } catch (ex) {
    log.error(APP_NAME, `Unable to get Firebase reference...`, ex);
  }

  if (!validateConfig(_config)) {
    try {
      log.log(APP_NAME, 'Reading config from local file...');
      const cfg = await fs.readFile('config.json', {encoding: 'utf8'});
      _config = JSON.parse(cfg);
    } catch (ex) {
      log.fatal(APP_NAME, `Unable to read/parse local config file.`, ex);
      process.exit(1);
    }
  }

  if (!validateConfig(_config)) {
    const msg = `Invalid config, or missing key properties.`;
    const cfgType = _config && _config._configType ? _config._configType : null;
    log.fatal(APP_NAME, msg, cfgType);
    process.exit(1);
  }

  _deviceMonitor = new DeviceMonitor(APP_NAME);
  _deviceMonitor.on('restart_request', () => {
    _deviceMonitor.restart('FB', 'restart_request', false);
  });
  _deviceMonitor.on('shutdown_request', () => {
    _deviceMonitor.shutdown('FB', 'shutdown_request', false);
  });
  _deviceMonitor.on('connection_timedout', () => {
    _deviceMonitor.restart('FB', 'connection_timedout', false);
  });

  initIPListener();

  setInterval(async () => {
    await log.cleanFile();
    await log.cleanLogs(null, 1);
  }, 60 * 60 * 24 * 1000);
}

/**
 *
 */
async function initIPListener() {
  const fbRootRef = await FBHelper.getRootRefUnlimited();
  const fbStateIP = await fbRootRef.child('state/externalIP');
  const myIP = new MyIP(_config.googleDNS);
  myIP.on('change', (ip) => {
    fbStateIP.set(ip)
        .then(() => {
          log.log(APP_NAME, `Updated saved IP address to '${ip}'`);
        })
        .catch((err) => {
          log.error(APP_NAME, 'Unable to update IP address.', err);
        });
  });
}

/**
 * Validate the config file meets the requirements.
 *
 * @param {Object} config
 * @return {Boolean} true if good.
 */
function validateConfig(config) {
  if (!config) {
    return false;
  }
  if (config._configType !== 'VPN') {
    return false;
  }
  if (!config.hasOwnProperty('googleDNS')) {
    return false;
  }
  return true;
}


process.on('SIGINT', function() {
  log.log(APP_NAME, 'SIGINT received.');
  _deviceMonitor.shutdown('SIGINT', 'shutdown_request', 0);
});

init();
