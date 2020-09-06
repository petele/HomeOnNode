/* eslint no-console: ["error", { "allow": ["error"] }] */

'use strict';

/* node14_ready */

const fs = require('fs');
const MyIP = require('./MyIP');
const log = require('./SystemLog2');
const FBHelper = require('./FBHelper');
const DeviceMonitor = require('./DeviceMonitor');

let _myIP;
let _config;
let _deviceMonitor;

const APP_NAME = 'VPNMonitor';

// Read config file
try {
  // eslint-disable-next-line no-console
  console.log(`Reading 'config.json'...`);
  const config = fs.readFileSync('config.json', {encoding: 'utf8'});
  // eslint-disable-next-line no-console
  console.log(`Parsing 'config.json'...`);
  _config = JSON.parse(config);
} catch (ex) {
  console.error(`Unable to read or parse 'config.json'`);
  console.error(ex);
  process.exit(1);
}

// Setup logging
log.setAppName(APP_NAME);
log.setOptions({
  firebaseLogLevel: _config.logLevel || 50,
});
log.startWSS();
log.appStart();

/**
 * Init
 */
async function init() {
  const fbLogRef = FBHelper.getRef(`logs/${APP_NAME}`);
  log.setFirebaseRef(fbLogRef);

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

  const fbHoNStateIP = await FBHelper.getRef('state/externalIP');
  _myIP = new MyIP(_config.googleDNS);
  _myIP.on('change', (ip) => {
    fbHoNStateIP.set(ip);
  });

  const fbLogConfig = await FBHelper.getRef(`config/${APP_NAME}/logLevel`);
  fbLogConfig.on('value', (snapshot) => {
    const logLevel = snapshot.val();
    log.setOptions({
      firebaseLogLevel: logLevel || 50,
    });
    log.log(APP_NAME, `Log level changed to ${logLevel}`);
  });

  setInterval(() => {
    log.cleanFile();
    log.cleanLogs(1);
  }, 60 * 60 * 24 * 1000);
}


process.on('SIGINT', function() {
  log.log(APP_NAME, 'SIGINT received.');
  _deviceMonitor.shutdown('SIGINT', 'shutdown_request', 0);
});

init();
