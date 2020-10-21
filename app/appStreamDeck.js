/* eslint no-console: ["error", { "allow": ["error"] }] */

'use strict';

/* node14_ready */

const path = require('path');
const sharp = require('sharp');
const fs = require('fs/promises');
const log = require('./SystemLog2');
const FBHelper = require('./FBHelper');
const WSClient = require('./WSClient');
const DeviceMonitor = require('./DeviceMonitor');
const {openStreamDeck} = require('elgato-stream-deck');

const LOG_PREFIX = 'STREAM_DECK';
const APP_NAME = process.argv[2];

const _keyData = {};
let _config;
let _wsClient;
let _deviceMonitor;
let _fbRootRef;
let _fbConfigRef;
let _streamDeck;


/**
 * Init
 *
 * @see https://github.com/Lange/node-elgato-stream-deck
 *
 */
async function init() {
  log.startWSS();
  log.setFileLogOpts(50, './logs/keypad.log');
  log.setFirebaseLogOpts(50, `logs/apps/${APP_NAME}`);

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

  _deviceMonitor = new DeviceMonitor(APP_NAME);
  _deviceMonitor.on('restart_request', () => {
    _close();
    _deviceMonitor.restart('FB', 'restart_request', false);
  });
  _deviceMonitor.on('shutdown_request', () => {
    _close();
    _deviceMonitor.shutdown('FB', 'shutdown_request', false);
  });

  try {
    _streamDeck = openStreamDeck();
  } catch (ex) {
    log.exception(LOG_PREFIX, 'Unable to connect to StreamDeck', ex);
    process.exit(1);
  }
  _streamDeck.on('down', _handleKeyPress);
  _streamDeck.on('error', (err) => {
    log.error(LOG_PREFIX, 'StreamDeck error', err);
    _deviceMonitor.shutdown('ERR', 'streamdeck_error', 1);
  });
  _initConfigListeners();

  _wsClient = new WSClient(_config.wsServer, true, 'server');

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
  fbConfig.child('brightness').on('value', (snapshot) => {
    const bri = snapshot.val();
    log.log(LOG_PREFIX, `Brightness changed to ${bri}`);
    _streamDeck.setBrightness(bri);
  });
  fbConfig.child('keys').on('child_added', (snapshot) => {
    _updateKey(snapshot.val());
  });
  fbConfig.child('keys').on('child_changed', (snapshot) => {
    _updateKey(snapshot.val());
  });
  fbConfig.child('keys').on('child_removed', (snapshot) => {
    _removeKey(snapshot.val());
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
  if (config._configType !== 'stream-deck') {
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
 *
 * @param {Object} keyData
 */
function _updateKey(keyData) {
  const keyId = keyData.id;
  _keyData[keyId] = keyData;
  if (keyData.icon) {
    _setIconOnButton(keyId, keyData.icon);
  } else if (keyData.buttonColor) {
    const r = keyData.buttonColor.red;
    const g = keyData.buttonColor.green;
    const b = keyData.buttonColor.blue;
    _streamDeck.fillColor(keyId, r, g, b);
  } else {
    _setIconOnButton(keyId, 'icons/help.svg');
  }
  log.log(LOG_PREFIX, `Updated key id: ${keyId}`, keyData);
}

/**
 *
 * @param {*} buttonId
 * @param {*} imagePath
 */
function _setIconOnButton(buttonId, imagePath) {
  const iconSize = _streamDeck.ICON_SIZE;
  sharp(path.resolve(__dirname, imagePath))
      .flatten()
      .resize(iconSize, iconSize)
      .raw()
      .toBuffer()
      .then((buffer) => {
        _streamDeck.fillImage(buttonId, buffer);
      })
      .catch((err) => {
        log.error(LOG_PREFIX, `Unable to set image on button ${buttonId}`, err);
      });
}

/**
 *
 * @param {Object} keyData
 */
function _removeKey(keyData) {
  const keyId = keyData.id;
  _keyData[keyId] = null;
  _streamDeck.clearKey(keyId);
  log.log(LOG_PREFIX, `Removed key id: ${keyId}`);
}

/**
 * Handles a key press
 *
 * @param {Number} keyId Character hit by the user.
 */
function _handleKeyPress(keyId) {
  const msg = `Key pressed: ${keyId}`;
  const keyData = _keyData[keyId];
  if (!keyData) {
    log.verbose(LOG_PREFIX, `${msg} - no command set for key.`);
    return;
  }
  if (keyData.actions) {
    log.log(LOG_PREFIX, msg, keyData);
    keyData.actions.forEach((cmd) => {
      _sendCommand(cmd);
    });
    return;
  }
  log.warn(LOG_PREFIX, `${msg} - No command found.`, keyData);
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
