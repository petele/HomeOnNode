/* eslint no-console: ["error", { "allow": ["error"] }] */

'use strict';

/* node14_ready */

const fs = require('fs');
const Keypad = require('./Keypad');
const log = require('./SystemLog2');
const WSClient = require('./WSClient');
const FBHelper = require('./FBHelper');
const DeviceMonitor = require('./DeviceMonitor');

let _config;
let _wsClient;
let _deviceMonitor;

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

// Verify config has appName
if (!_config.appName) {
  console.error(`'appName' not set in config.`);
  process.exit(1);
}
const APP_NAME = _config.appName;

// Verify config has wsServer
if (!_config.wsServer) {
  console.error(`'wsServer' not set in config.`);
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
    _close();
    _deviceMonitor.restart('FB', 'restart_request', false);
  });
  _deviceMonitor.on('shutdown_request', () => {
    _close();
    _deviceMonitor.shutdown('FB', 'shutdown_request', false);
  });

  const fbConfig = await FBHelper.getRef(`config/${APP_NAME}`);
  fbConfig.child(`logLevel`).on('value', (snapshot) => {
    const logLevel = snapshot.val();
    log.setOptions({
      firebaseLogLevel: logLevel || 50,
    });
    log.log(APP_NAME, `Log level changed to ${logLevel}`);
  });
  fbConfig.child(`keypad`).on('value', (snapshot) => {
    _config.keypad = snapshot.val();
    log.log(APP_NAME, 'Keypad settings updated.');
  });
  fbConfig.child(`disabled`).on('value', (snapshot) => {
    _config.disabled = snapshot.val();
    log.log(APP_NAME, `'disabled' changed to '${_config.disabled}'`);
  });

  _wsClient = new WSClient(_config.wsServer, true, 'server');
  Keypad.listen(_config.keypad.modifiers, _handleKeyPress);

  setInterval(() => {
    log.cleanFile();
    log.cleanLogs(7);
  }, 60 * 60 * 24 * 1000);
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

init();
