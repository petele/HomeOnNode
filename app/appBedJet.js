/* eslint no-console: ["error", { "allow": ["error"] }] */

'use strict';

const fs = require('fs/promises');
const log = require('./SystemLog2');
const FBHelper = require('./FBHelper');
const WSServer = require('./WSServer');
const CronJob = require('cron').CronJob;
const HonHelpers = require('./HoNHelpers');
const DeviceMonitor = require('./DeviceMonitor');

const {BedJet} = require('./BedJetLib');

const LOG_FILE = './logs/bedjet.log';
const LOG_PREFIX = 'BEDJET';
const CONFIG_FILE = 'config.json';
const APP_NAME = 'BedJetController';
const FB_STATE_PATH = 'state/bedJet/host';
const BJ_RETRIES = 5;

let _bedJet;
let _config;
let _fbState;
let _wsServer;
let _deviceMonitor;
let _commandInProgress = false;

const _queue = [];
const _cronJobs = [];

/**
 * Init
 */
async function init() {
  log.startWSS(8881);
  log.setFileLogOpts(50, LOG_FILE);
  log.setFirebaseLogOpts(50, `logs/apps/${APP_NAME}`);

  log.appStart(APP_NAME);

  try {
    log.log(LOG_PREFIX, `Reading config from '${CONFIG_FILE}'`);
    const encOpt = {encoding: 'utf8'};
    const config = JSON.parse(await fs.readFile(CONFIG_FILE, encOpt));
    if (!validateConfig(config)) {
      throw new Error('invalid_config');
    }
    _config = config;
  } catch (ex) {
    log.fatal(LOG_PREFIX, `Unable to read/parse '${CONFIG_FILE}'.`, ex);
    process.exit(1);
  }

  // Start the device monitor.
  _initDeviceMonitor();

  // Initialize the Reboot Cron Job
  _initRebootCron();

  // Listen for config changes.
  _initConfigListeners();

  // Start the WebSocket Server
  _initWSServer();

  // Initialize BedJet API
  _initBedJet();

  // Clean up logs every 24 hours
  setInterval(async () => {
    await log.cleanFile(LOG_FILE);
    await log.cleanLogs(null, 7);
  }, 60 * 60 * 24 * 1000);
}


/**
 * Init Device Monitor
 */
function _initDeviceMonitor() {
  _deviceMonitor = new DeviceMonitor(APP_NAME);
  _deviceMonitor.on('restart_request', () => {
    _close();
    _deviceMonitor.restart('FB', 'restart_request', false);
  });
  _deviceMonitor.on('shutdown_request', () => {
    _close();
    _deviceMonitor.shutdown('FB', 'shutdown_request', 0);
  });
}

/**
 * Init the Reboot Cron Job
 */
function _initRebootCron() {
  while (_cronJobs.length > 0) {
    const job = _cronJobs.shift();
    job.stop();
  }
  const jobs = _config.rebootCron || [];
  jobs.forEach((pattern) => {
    if (!pattern || typeof pattern !== 'string' || pattern.length === 0) {
      return;
    }
    log.log(LOG_PREFIX, 'Creating reboot cron job.', pattern);
    const job = new CronJob(pattern, () => {
      _close();
      DeviceMonitor.restart('cron', 'cron_restart', false);
    }, null, true, 'America/New_York');
    job.start();
    _cronJobs.push(job);
  });
}

/**
 * Setup the Firebase config listeners.
 */
async function _initConfigListeners() {
  const fbRoot = await FBHelper.getRootRefUnlimited();
  _fbState = await fbRoot.child(FB_STATE_PATH);
  const fbConfig = await fbRoot.child(`config/${APP_NAME}`);
  fbConfig.on('value', async (snapshot) => {
    const newConfig = snapshot.val();
    if (!validateConfig(newConfig)) {
      log.error(LOG_PREFIX, `New config is invalid`, newConfig);
      return;
    }
    _config = newConfig;
    try {
      log.log(LOG_PREFIX, `Writing updated config to '${CONFIG_FILE}'.`);
      await fs.writeFile(CONFIG_FILE, JSON.stringify(newConfig, null, 2));
    } catch (ex) {
      log.exception(LOG_PREFIX, 'Unable to write config to disk.', ex);
    }
  });
  const fbCronConfig = await fbRoot.child(`config/${APP_NAME}/rebootCron`);
  fbCronConfig.on('value', () => {
    _initRebootCron();
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
  if (config._configType !== 'bedJet') {
    return false;
  }
  if (!config.hasOwnProperty('address')) {
    return false;
  }
  return true;
}

/**
 * Setup the Web Socket Server
 */
function _initWSServer() {
  _wsServer = new WSServer('WSS', _config.serverPort || 8884);
  _wsServer.on('message', (cmd, sender) => {
    const msg = `Incoming message`;
    const info = {cmd, sender};
    if (_config.disabled) {
      log.log(LOG_PREFIX, `${msg}: ignored (disabled)`, info);
      return;
    }
    if (cmd.sendButton) {
      return _sendButton(cmd.sendButton);
    }
    log.warn(LOG_PREFIX, `${msg}: ignored (unknown)`, info);
  });
}

/**
 * Sends a button press to the BedJet.
 *
 * @param {string} button Button id to send
 */
async function _sendButton(button) {
  if (_commandInProgress) {
    _queue.push(button);
    return;
  }
  _commandInProgress = true;
  const msg = `sendButton('${button}')`;
  log.log(LOG_PREFIX, msg);
  try {
    await _bedJet.connect(BJ_RETRIES);
    await _bedJet.sendButton(button, BJ_RETRIES);
    const state = await _bedJet.getState(BJ_RETRIES);
    _updateState(state);
    await _bedJet.disconnect(BJ_RETRIES);
  } catch (ex) {
    log.exception(LOG_PREFIX, `${msg} - failed.`, ex);
  }
  _commandInProgress = false;
  if (_queue.length > 0) {
    await HonHelpers.sleep(750);
    await _sendButton(_queue.shift());
  }
}

/**
 * Parse state object and save it to Firebase.
 *
 * @param {object} state State object
 */
async function _updateState(state) {
  if (state.raw) {
    delete state.raw;
  }
  _fbSet('state', state);
}

/**
 * Init the BedJet
 */
function _initBedJet() {
  log.init(LOG_PREFIX, 'Init BedJet');
  _bedJet = new BedJet(_config.address);
  _bedJet.on('error', (err) => {
    log.exception(LOG_PREFIX, `BedJet API error`, err);
  });
  _bedJet.on('ready', () => {
    log.log(LOG_PREFIX, 'BedJet ready.');
    _fbSet('ready', true);
  });
  _bedJet.on('connected', (val) => {
    log.log(LOG_PREFIX, `BedJet Connected: ${val}`);
    _fbSet('connected', val);
  });
}

/**
 * Saves data to Firebase.
 *
 * @param {string} path Child path to set
 * @param {any} value Value to save
 */
function _fbSet(path, value) {
  if (!_fbState) {
    log.error(LOG_FILE, 'Unable to update Firebase state', {path, value});
    return;
  }
  _fbState.child(path).set(value);
}

/**
 * Exit the app.
*/
function _close() {
  log.log(LOG_PREFIX, 'Preparing to exit, closing all connections...');
  if (_wsServer) {
    _wsServer.shutdown();
  }
  if (_bedJet) {
    _bedJet.destroy();
  }
  _fbSet('ready', false);
}

process.on('SIGINT', function() {
  log.log(LOG_PREFIX, 'SigInt received, shutting down...');
  _close();
  _deviceMonitor.shutdown('SIGINT', 'shutdown_request', 0);
});


init().catch((err) => {
  _close();
  log.fatal(LOG_PREFIX, 'Init error', err);
});
