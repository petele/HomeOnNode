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

const DELAY_BETWEEN_COMMANDS = 1500;
const COMMAND_TIMEOUT = 4 * 60 * 1000;

let _bedJet;
let _address;
let _disabled;
let _wsServer;
let _bjRetries;
let _serverPort;
let _deviceMonitor;
let _stateInterval;
let _commandInProgress;
let _stateIntervalMinutes;

let _ready = false;

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
    _parseConfig(config, true);
  } catch (ex) {
    log.fatal(LOG_PREFIX, `Unable to read/parse '${CONFIG_FILE}'.`, ex);
    process.exit(1);
  }

  // Start the device monitor.
  _initDeviceMonitor();

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
  }, 24 * 60 * 60 * 1000);
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
 *
 * @param {Array<Object>} jobs List of cron jobs
 */
function _initRebootCron(jobs) {
  while (_cronJobs.length > 0) {
    const job = _cronJobs.shift();
    job.stop();
  }
  if (!jobs || !Array.isArray(jobs)) {
    log.log(LOG_PREFIX, 'No jobs provided.', jobs);
    return;
  }
  jobs.forEach((pattern) => {
    if (!pattern || typeof pattern !== 'string' || pattern.length === 0) {
      log.warn(LOG_PREFIX, 'Invalid cron reboot pattern provided', pattern);
      return;
    }
    if (pattern.split(' ').length !== 5) {
      const info = {
        expected: '# # * * *',
        got: pattern,
      };
      log.warn(LOG_PREFIX, 'Invalid cron reboot pattern', info);
      return;
    }
    log.log(LOG_PREFIX, 'Creating reboot cron job.', pattern);
    const job = new CronJob(pattern, () => {
      _close();
      _deviceMonitor.restart('cron', 'cron_restart', false);
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
  const fbConfig = await fbRoot.child(`config/${APP_NAME}`);
  fbConfig.on('value', async (snapshot) => {
    const newConfig = snapshot.val();
    try {
      _parseConfig(newConfig);
    } catch (ex) {
      log.exception(LOG_PREFIX, 'Error parsing config data', ex);
      return;
    }
    try {
      log.log(LOG_PREFIX, `Writing updated config to '${CONFIG_FILE}'.`);
      await fs.writeFile(CONFIG_FILE, JSON.stringify(newConfig, null, 2));
    } catch (ex) {
      log.exception(LOG_PREFIX, 'Unable to write config to disk.', ex);
    }
  });
  const fbCronConfig = await fbRoot.child(`config/${APP_NAME}/rebootCron`);
  fbCronConfig.on('value', (snapshot) => {
    const jobs = snapshot.val() || [];
    _initRebootCron(jobs);
  });
}

/**
 * Parse the config object and update any timers.
 *
 * @param {Object} newConfig Config options
 * @param {boolean} firstRun First run (setup reboot cron jobs)
 */
function _parseConfig(newConfig, firstRun) {
  if (!newConfig) {
    throw new Error('no_config');
  }
  if (newConfig._configType !== 'bedJet') {
    throw new Error('wrong_config_type');
  }
  if (!newConfig.hasOwnProperty('address')) {
    throw new Error('config_missing_address');
  }
  _address = newConfig.address;
  _disabled = newConfig.disabled === true;
  if (typeof newConfig.serverPort === 'number') {
    _serverPort = newConfig.serverPort;
  } else {
    _serverPort = 8884;
  }
  const newRetries = newConfig.retries;
  if (typeof newRetries === 'number' && newRetries > 0) {
    _bjRetries = newRetries;
  } else {
    _bjRetries = 5;
  }
  const newInterval = newConfig.stateInterval;
  if (typeof newInterval === 'number' && newInterval > 0) {
    _stateIntervalMinutes = newInterval;
  } else {
    _stateIntervalMinutes = 7;
  }
  if (firstRun) {
    _initRebootCron(newConfig.rebootCron);
  }
}

/**
 * Setup the Web Socket Server
 */
function _initWSServer() {
  _wsServer = new WSServer('WSS', _serverPort);
  _wsServer.on('message', (cmd, sender) => {
    const msg = `Incoming message`;
    const info = {cmd, sender};
    if (_disabled) {
      log.log(LOG_PREFIX, `${msg}: ignored (disabled)`, info);
      return;
    }
    if (!_ready) {
      log.warn(LOG_PREFIX, `${msg}: skipped (not_ready)`, info);
      _wsBroadcast({ready: false});
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
  const msg = `sendButton('${button}')`;
  if (_commandInProgress) {
    log.debug(LOG_PREFIX, `${msg} - queued.`);
    _queue.push(button);
    return;
  }
  _startCommandInProgress();
  log.log(LOG_PREFIX, msg);
  try {
    log.verbose(LOG_PREFIX, `${msg} - connecting...`);
    await _bedJet.connect(_bjRetries);
    log.verbose(LOG_PREFIX, `${msg} - connected, sending button press...`);
    await _bedJet.sendButton(button, _bjRetries);
    log.verbose(LOG_PREFIX, `${msg} - getting state...`);
    const rawState = await _bedJet.getState(_bjRetries);
    _wsBroadcast(_parseState(rawState));
    log.verbose(LOG_PREFIX, `${msg} - disconnecting...`);
    await _bedJet.disconnect(_bjRetries);
    log.verbose(LOG_PREFIX, `${msg} - disconnected.`);
  } catch (ex) {
    log.exception(LOG_PREFIX, `${msg} - failed.`, ex);
  }
  _clearCommandInProgress();
  if (_queue.length > 0) {
    await HonHelpers.sleep(DELAY_BETWEEN_COMMANDS);
    await _sendButton(_queue.shift());
  }
}

/**
 * Start the timer for Command in Progress, if timeout is exceeded, system
 * will reboot.
 */
function _startCommandInProgress() {
  _clearCommandInProgress();
  _commandInProgress = setTimeout(async () => {
    log.warn(LOG_PREFIX, `Timeout exceeded.`);
    _wsBroadcast({log: {reboot: true, message: 'timeout_exceeded'}});
    await HonHelpers.sleep(1000);
    _close();
    _deviceMonitor.restart('timeout', 'timeout_exceeded', false);
  }, COMMAND_TIMEOUT);
}

/**
 * Clear the timer for Command in Progress.
 */
function _clearCommandInProgress() {
  if (!_commandInProgress) {
    return;
  }
  clearTimeout(_commandInProgress);
  _commandInProgress = null;
}

/**
 * Get the current BedJet state.
 */
async function _getState() {
  const msg = `getState()`;
  if (_commandInProgress) {
    log.debug(LOG_PREFIX, `${msg} - skipped.`);
    return;
  }
  _startCommandInProgress();
  log.debug(LOG_PREFIX, msg);
  try {
    log.verbose(LOG_PREFIX, `${msg} - connecting...`);
    await _bedJet.connect(_bjRetries);
    log.verbose(LOG_PREFIX, `${msg} - getting state...`);
    const rawState = await _bedJet.getState(_bjRetries);
    _wsBroadcast(_parseState(rawState));
    log.verbose(LOG_PREFIX, `${msg} - disconnecting...`);
    await _bedJet.disconnect(_bjRetries);
  } catch (ex) {
    log.exception(LOG_PREFIX, `${msg} - failed.`, ex);
  }
  _clearCommandInProgress();
}

/**
 * Parse state object and save it to Firebase.
 *
 * @param {object} rawState State object
 * @return {object} Parsed state object
 */
function _parseState(rawState) {
  const temp = Object.assign({}, rawState);
  if (temp.raw) {
    delete temp.raw;
  }
  const now = Date.now();
  temp.lastUpdated = now;
  temp.lastUpdated_ = log.formatTime(now);
  let offAt;
  if (temp.mode === 'off') {
    offAt = 0;
  } else {
    offAt = now;
    if (temp.timeRemain.hours) {
      offAt += temp.timeRemain.hours * 60 * 60 * 1000;
    }
    if (temp.timeRemain.minutes) {
      offAt += temp.timeRemain.minutes * 60 * 1000;
    }
    if (temp.timeRemain.seconds) {
      offAt += temp.timeRemain.seconds * 1000;
    }
  }
  temp.timeRemain.offAt = offAt;
  temp.timeRemain.offAt_ = log.formatTime(offAt);
  const result = {state: temp};
  log.debug(LOG_PREFIX, 'State', temp);
  return result;
}

/**
 * Init the BedJet
 */
function _initBedJet() {
  log.init(LOG_PREFIX, 'Init BedJet', _address);
  _bedJet = new BedJet(_address);
  _bedJet.on('error', (err) => {
    log.exception(LOG_PREFIX, `BedJet API error`, err);
  });
  _bedJet.on('ready', () => {
    _ready = true;
    _wsBroadcast({ready: true});
    log.log(LOG_PREFIX, 'BedJet ready.');
    _updateStateTick();
  });
  _bedJet.on('connected', (val) => {
    log.debug(LOG_PREFIX, `BedJet Connected: ${val}`);
  });
}

/**
 * Refreshes the BedJet state every stateIntervalMinutes
 */
async function _updateStateTick() {
  await _getState();
  _stateInterval = setTimeout(() => {
    _updateStateTick();
  }, _stateIntervalMinutes * 60 * 1000);
}


/**
 * Send a message to all connected clients.
 *
 * @param {object} msg Message to send to all clients
 */
function _wsBroadcast(msg) {
  if (!_wsServer) {
    log.verbose(LOG_PREFIX, `wsBroadcast() skipped, no WS server.`);
    return;
  }
  log.log(LOG_PREFIX, 'Broadcast', msg);
  const strMsg = JSON.stringify(msg);
  _wsServer.broadcast(strMsg);
}

/**
 * Exit the app.
*/
function _close() {
  log.log(LOG_PREFIX, 'Preparing to exit, closing all connections...');
  _ready = false;
  if (_stateInterval) {
    clearTimeout(_stateInterval);
    _stateInterval = null;
  }
  if (_wsServer) {
    _wsServer.shutdown();
  }
  if (_bedJet) {
    _bedJet.destroy();
  }
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
