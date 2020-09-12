/* eslint no-console: ["error", { "allow": ["error"] }] */

'use strict';

const fs = require('fs/promises');
const log = require('./SystemLog2');
const GCMPush = require('./GCMPush');
const FBHelper = require('./FBHelper');
const WSClient = require('./WSClient');
const deepDiff = require('deep-diff').diff;
const DeviceMonitor = require('./DeviceMonitor');

const LOG_PREFIX = 'APP_REMOTE';
const LOG_FILE = './logs/gpio.log';
const CONFIG_FILE = 'config-gpio.json';

const APP_NAME = process.argv[2];

let GPIO;
let _fbRootRef;
let _fbConfigRef;
let _config;
let _deviceMonitor;
let _wsClient;
let _gcmPush;

const EDGES = ['none', 'rising', 'falling', 'both'];

/**
 * Init
 */
async function init() {
  log.startWSS();
  log.setFileLogOpts(50, LOG_FILE);
  log.setFirebaseLogOpts(50, `logs/${APP_NAME.toLowerCase()}`);

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
      const cfg = await fs.readFile(CONFIG_FILE, {encoding: 'utf8'});
      _config = JSON.parse(cfg);
    } catch (ex) {
      log.fatal(LOG_PREFIX, `Unable to read/parse '${CONFIG_FILE}'.`, ex);
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
    _deviceMonitor.shutdown('FB', 'shutdown_request', 0);
  });

  // Initialize GPIO
  try {
    GPIO = require('onoff').Gpio;
  } catch (ex) {
    log.fatal(APP_NAME, `Node module 'onoff' is not available.`, ex);
    process.exit(1);
  }

  // Connect to the web socket server
  if (_config.wsServer) {
    _wsClient = new WSClient(_config.wsServer, true, 'server');
  }
  // Initialize GCMPush
  _gcmPush = await new GCMPush();

  // Register listeners on each pin
  _config.pins.forEach(_registerPin);

  _initConfigListeners();

  setInterval(async () => {
    await log.cleanFile(LOG_FILE);
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
    const diff = deepDiff(_config, newConfig);
    console.log('diff', diff);
    return;
    if (!deepDiff(_config, newConfig)) {
      return;
    }
    try {
      await fs.writeFile(CONFIG_FILE, JSON.stringify(newConfig));
      log.verbose(LOG_PREFIX, `Wrote config to '${CONFIG_FILE}'.`);
      _close();
      _deviceMonitor.restart('config', 'config_changed', 0);
    } catch (ex) {
      log.exception(LOG_PREFIX, 'Unable to write config to disk.', ex);
    }
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
  if (config._configType !== 'gpio') {
    return false;
  }
  if (!config.hasOwnProperty('wsServer')) {
    return false;
  }
  return true;
}


/**
 * Event handler to register a pin.
 *
 * @param {Object} details Pin information details
 * @return {Boolean} true if successfully registered pin
 */
function _registerPin(details) {
  const pinNumber = details.pinNumber;
  if (!pinNumber) {
    log.error(APP_NAME, `Invalid pin number`, details);
    return false;
  }
  if (details.disabled) {
    log.log(APP_NAME, `Pin '${pinNumber}' disabled`);
    return false;
  }
  const edge = details.edge || 'both';
  if (!EDGES.includes(edge)) {
    log.error(APP_NAME, `Invalid edge (${edge}) for pin ${pinNumber}`);
    return false;
  }
  log.log(APP_NAME, `Listening on pin ${pinNumber} on edge: ${edge}`);
  details.lastPushed = 0;
  const pin = new GPIO(pinNumber, 'in', edge);
  if (details.invert) {
    log.debug(APP_NAME, `Inverting value on pin ${pinNumber}`);
    pin.setActiveLow(true);
  }
  const value = pin.readSync();
  details.lastValue = value;
  log.debug(APP_NAME, `Pin ${pinNumber} is currently: ${value}`);
  pin.watch((err, val) => {
    _pinChanged(details, err, val);
  });
  return true;
}

/**
 * Event handler for pin changed.
 *
 * @param {Object} pin Pin details
 * @param {Object} err Error object
 * @param {Number} value New value
 */
function _pinChanged(pin, err, value) {
  if (err) {
    const msg = `Error on pin changed for pin ${pin.pinNumber}`;
    log.error(APP_NAME, msg, err);
    return;
  }
  const now = Date.now();
  const debounceDelay = pin.debounceDelay || 250;
  const hasChanged = value !== pin.lastValue;
  const msSinceLastPush = now - pin.lastPushed;
  const timeOK = msSinceLastPush > debounceDelay;
  const msg = `pinNumber: ${pin.pinNumber} - ` +
              `value: ${value} | ` +
              `hasChanged: ${hasChanged}, ` +
              `timeOK: ${timeOK} -|- ` +
              `debounceDelay: ${debounceDelay}, ` +
              `msSinceLastPushed: ${msSinceLastPush}`;
  log.debug(APP_NAME, msg);
  pin.lastValue = value;
  if (hasChanged && timeOK) {
    pin.lastPushed = now;
    log.debug(APP_NAME, `Pin '${pin.pinNumber}' changed to '${value}'`);
    let command;
    let message;
    if (value === 1) {
      command = pin.cmdTrue;
      message = pin.msgTrue;
    } else if (value === 0) {
      command = pin.cmdFalse;
      message = pin.msgFalse;
    }
    if (_config.disabled === true) {
      log.warn(APP_NAME, `Command not sent, ${APP_NAME} is disabled`);
      return;
    }
    if (command && _wsClient) {
      _wsClient.send(JSON.stringify(command)).catch((err) => {
        log.error(APP_NAME, `Unable to send command`, err);
        log.debug(APP_NAME, `Command sent`, command);
      });
    }
    if (message && _gcmPush) {
      _gcmPush.sendMessage(message).catch((err) => {
        log.error(APP_NAME, `Unable to send message`, err);
        log.debug(APP_NAME, `Message sent`, message);
      });
    }
  }
}

/**
 * Exit the app.
*/
function _close() {
  log.log(APP_NAME, 'Preparing to exit, closing all connections...');
  if (_wsClient) {
    _wsClient.shutdown();
  }
}

process.on('SIGINT', function() {
  log.log(APP_NAME, 'SigInt received, shutting down...');
  _close();
  _deviceMonitor.shutdown('SIGINT', 'shutdown_request', 0);
});

if (APP_NAME) {
  return init();
} else {
  log.fatal(LOG_PREFIX, 'No app name provided.');
}
