/* eslint no-console: ["error", { "allow": ["error"] }] */

'use strict';

/* node14_ready */

const fs = require('fs/promises');
const Keypad = require('./Keypad');
const log = require('./SystemLog2');
const FBHelper = require('./FBHelper');
const WSClient = require('./WSClient');
const DeviceMonitor = require('./DeviceMonitor');

const LOG_PREFIX = 'APP_REMOTE';
const APP_NAME = process.argv[2];

let _config;
let _wsClient;
let _deviceMonitor;
let _fbRootRef;
let _fbConfigRef;


/**
 * Init
 */
async function init() {
  log.startWSS();
  log.setFileLogOpts(50, './logs/system.log');
  log.setFirebaseLogOpts(50, `logs/${APP_NAME}`);

  log.appStart(APP_NAME);

  try {
    log.log(LOG_PREFIX, 'Reading config from Firebase...');
    _fbRootRef = await FBHelper.getRootRef(30 * 1000);
    _fbConfigRef = await _fbRootRef.child(`config/${APP_NAME}`);
    _config = await _fbConfigRef.once('value');
    _config = _config.val();
  } catch (ex) {
    log.error(LOG_PREFIX, `Unable to get Firebase reference...`, ex);
  }

  if (!validateConfig(_config)) {
    try {
      log.log(LOG_PREFIX, 'Reading config from local file...');
      const cfg = await fs.readFile('config.json', {encoding: 'utf8'});
      _config = JSON.parse(cfg);
    } catch (ex) {
      log.fatal(LOG_PREFIX, `Unable to read/parse local config file.`, ex);
      process.exit(1);
    }
  }

  if (!validateConfig(_config)) {
    const msg = `Invalid config, or missing key properties.`;
    log.fatal(LOG_PREFIX, msg, _config);
    process.exit(1);
  }

  _initConfigListeners();

  _deviceMonitor = new DeviceMonitor(APP_NAME);
  _deviceMonitor.on('restart_request', () => {
    _close();
    _deviceMonitor.restart('FB', 'restart_request', false);
  });
  _deviceMonitor.on('shutdown_request', () => {
    _close();
    _deviceMonitor.shutdown('FB', 'shutdown_request', false);
  });

  _wsClient = new WSClient(_config.wsServer, true, 'server');
  Keypad.listen(_config.keypad.modifiers, _handleKeyPress);

  setInterval(async () => {
    await log.cleanFile();
    await log.cleanLogs(null, 7);
  }, 60 * 60 * 24 * 1000);
}

/**
 * Set up the Firebase config listeners...
 */
async function _initConfigListeners() {
  const fbRoot = await FBHelper.getRootRefUnlimited();
  const fbConfig = await fbRoot.child(`config/${APP_NAME}`);
  fbConfig.on('value', async (snapshot) => {
    const newConfig = snapshot.val();
    if (!validateConfig(newConfig)) {
      log.error(LOG_PREFIX, 'New config is invalid.', newConfig);
      return;
    }
    _config = newConfig;
    await fs.writeFile('config.json', JSON.stringify(_config, null, 2));
    log.log(LOG_PREFIX, 'Config updated, written to disk...');
  });
  fbConfig.child('disabled').on('value', (snapshot) => {
    _config.disabled = snapshot.val();
    log.log(APP_NAME, `'disabled' changed to '${_config.disabled}'`);
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
  if (config._configType !== 'remote') {
    return false;
  }
  if (!config.hasOwnProperty('wsServer')) {
    return false;
  }
  return true;
}


/**
 * Send a command
 *
 * @param {Object} command Command to send.
 * @return {Promise} The result of the ws send command.
*/
function _sendCommand(command) {
  if (_wsClient) {
    return _wsClient.send(JSON.stringify(command));
  }
  log.error(APP_NAME, `WebSocket client not ready.`);
}

/**
 * Handles a key press
 *
 * @param {String} key Character hit by the user.
 * @param {String} modifier If a modifier is used.
 * @param {Boolean} exitApp If the app should exit.
 */
function _handleKeyPress(key, modifier, exitApp) {
  const cmd = _config.keypad.keys[key];
  const details = {
    key: key,
    modifier: modifier,
    exitApp: exitApp,
    cmd: cmd,
  };
  log.verbose(APP_NAME, 'Key pressed', details);
  if (_config.disabled === true) {
    log.warn(APP_NAME, 'AppRemote disabled by config', details);
    return;
  }
  if (exitApp) {
    _close();
    _deviceMonitor.shutdown('USER', 'exit_key', 0);
    return;
  }
  if (!cmd) {
    log.warn(APP_NAME, `Unknown key pressed.`, details);
    return;
  }
  _sendCommand(cmd);
}

/**
 * Exit the app.
 *
 * @param {String} sender Who is requesting the app to exit.
 * @param {Number} exitCode The exit code to use.
*/
function _close() {
  log.log(APP_NAME, 'Preparing to exit, closing all connections...');
  if (_wsClient) {
    _wsClient.shutdown();
  }
}

process.on('SIGINT', function() {
  _close();
  _deviceMonitor.shutdown('SIGINT', 'shutdown_request', 0);
});


if (APP_NAME) {
  return init();
} else {
  log.fatal(LOG_PREFIX, 'No app name provided.');
}
