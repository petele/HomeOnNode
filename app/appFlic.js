/* eslint no-console: ["error", { "allow": ["error"] }] */

'use strict';

const fs = require('fs/promises');
const log = require('./SystemLog2');
const FBHelper = require('./FBHelper');
const WSClient = require('./WSClient');
const DeviceMonitor = require('./DeviceMonitor');

const FlicLib = require('./FlicLib/FlicLibNodeJS');
const FlicClient = FlicLib.FlicClient;
const FlicScanWizard = FlicLib.FlicScanWizard;
const FlicConnectionChannel = FlicLib.FlicConnectionChannel;
const FlicBatteryStatusListener = FlicLib.FlicBatteryStatusListener;

const LOG_FILE = './logs/flic.log';
const LOG_PREFIX = 'FLIC';
const CONFIG_FILE = 'config-flic.json';
const APP_NAME = 'FlicController';
const APP_MODE = process.argv[2] === 'scan' ? 'SCAN' : 'LISTEN';

let _config;
let _wsClient;
let _flicClient;
let _flicScanner;
let _deviceMonitor;
const _flicButtons = {};

/**
 * Init
 */
async function init() {
  log.startWSS(8883);
  log.setFileLogOpts(50, LOG_FILE);
  log.setFirebaseLogOpts(50, `logs/apps/${APP_NAME}`);

  log.appStart(APP_NAME);

  try {
    log.log(LOG_PREFIX, 'Reading config from Firebase...');
    const fbRootRef = await FBHelper.getRootRef(30 * 1000);
    const fbConfigRef = await fbRootRef.child(`config/${APP_NAME}`);
    _config = await fbConfigRef.once('value');
    _config = _config.val();
  } catch (ex) {
    log.error(LOG_PREFIX, `Unable to get Firebase reference...`, ex);
  }

  if (!validateConfig(_config)) {
    try {
      log.log(LOG_PREFIX, `Reading config from '${CONFIG_FILE}'`);
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

  // Start the device monitor.
  _initDeviceMonitor();

  // Connect to the server.
  _wsClient = new WSClient(_config.wsServer, true, 'server');

  // Initialize Flic API
  _initFlic();

  // Listen for config changes.
  _initConfigListeners();

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
 * Setup the Firebase config listeners.
 */
async function _initConfigListeners() {
  const fbRoot = await FBHelper.getRootRefUnlimited();
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
      await fs.writeFile(CONFIG_FILE, JSON.stringify(newConfig));
    } catch (ex) {
      log.exception(LOG_PREFIX, 'Unable to write config to disk.', ex);
    }
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
  if (config._configType !== 'flic') {
    return false;
  }
  if (!config.hasOwnProperty('wsServer')) {
    return false;
  }
  return true;
}

/**
 * Initialize the flic client
 *
 * @param {String} [host]
 * @param {Number} [port]
 */
function _initFlic(host, port) {
  host = host || 'localhost';
  port = port || 5551;
  log.init(LOG_PREFIX, `Starting Flic client on ${host}:${port}`);
  _flicClient = new FlicClient(host, port);
  _flicClient.on('close', (hadError) => {
    if (hadError) {
      log.exception(LOG_PREFIX, 'Flic client closed with error', hadError);
    } else {
      log.log(LOG_PREFIX, 'Flic client closed.');
    }
    _close();
  });
  _flicClient.on('error', (error) => {
    log.exception(LOG_PREFIX, 'Flic client error', error);
  });
  _flicClient.on('bluetoothControllerStateChange', (state) => {
    log.log(LOG_PREFIX, `BlueTooth controller state changed to: ${state}`);
  });
  _flicClient.on('newVerifiedButton', (bdAddr) => {
    log.log(LOG_PREFIX, `New button found at ${bdAddr}`);
    _listenToButton(bdAddr);
  });
  _flicClient.once('ready', () => {
    log.log(LOG_PREFIX, 'Flic client ready');
    if (APP_MODE === 'SCAN') {
      _startScanWizard();
      return;
    }
    _flicClient.getInfo((info) => {
      log.log(LOG_PREFIX, `Flic client info`, info);
      info.bdAddrOfVerifiedButtons.forEach((bdAddr) => {
        _listenToButton(bdAddr);
      });
    });
  });
}

/**
 * Start the scan wizard to add buttons to the Flic
 */
function _startScanWizard() {
  log.log(LOG_PREFIX, 'Scan started, press Flic button to add it.');
  _flicScanner = new FlicScanWizard();
  _flicScanner.on('foundPrivateButton', () => {
    const msg = 'Found private button, hold for 7 seconds to make it public.';
    log.warn(LOG_PREFIX, msg);
  });
  _flicScanner.on('foundPublicButton', (bdAddr, name) => {
    const msg = `Found button '${name}' (${bdAddr}). Now connecting...`;
    log.log(LOG_PREFIX, msg);
  });
  _flicScanner.on('buttonConnected', (bdAddr, name) => {
    const msg = `Connected to '${name}' (${bdAddr}). Verifying & pairing...`;
    log.log(LOG_PREFIX, msg);
  });
  _flicScanner.on('completed', (result, bdAddr, name) => {
    if (result === 'WizardSuccess') {
      const msg = `Success! Button '${name}' (${bdAddr}) was added.`;
      log.log(LOG_PREFIX, msg);
      return;
    }
    const msg = `Problem adding '${name}' (${bdAddr}) - ${result}`;
    log.warn(LOG_PREFIX, msg);
  });
  _flicClient.addScanWizard(_flicScanner);
}

/**
 * Register a button and listen for presses
 *
 * @param {String} bdAddr
 */
function _listenToButton(bdAddr) {
  log.log(LOG_PREFIX, `Listening for button: ${bdAddr}`);
  _flicButtons[bdAddr] = {
    connectionState: 'init',
    lastPush: {
      kind: 'init',
      dateTime: 0,
    },
    battery: {
      value: 100,
      lastUpdated: 0,
    },
  };
  const cc = new FlicConnectionChannel(bdAddr);
  cc.on('connectionStatusChanged', (status, disconnectReason) => {
    const msg = `connectionStatusChanged for ${bdAddr} to ${status}`;
    log.log(LOG_PREFIX, msg, disconnectReason);
    _flicButtons[bdAddr].connectionState = status;
  });
  cc.on('removed', (reason) => {
    log.warn(LOG_PREFIX, `Button ${bdAddr} was removed because ${reason}`);
    _flicButtons[bdAddr].connectionState = 'removed';
  });
  cc.on('buttonSingleOrDoubleClickOrHold', (clickType, wasQueued, timeDiff) => {
    const obj = {bdAddr, clickType, wasQueued, timeDiff};
    log.debug(LOG_PREFIX, `Button '${bdAddr}' was ${clickType}`, obj);
    _sendButtonPress(bdAddr, clickType, wasQueued, timeDiff);
    _flicButtons[bdAddr].lastPush.dateTime = Date.now();
    _flicButtons[bdAddr].lastPush.kind = clickType;
  });
  _flicClient.addConnectionChannel(cc);
  const batteryStatus = new FlicBatteryStatusListener(bdAddr);
  batteryStatus.on('batteryStatus', (data) => {
    _sendBatteryUpdate(bdAddr, data);
  });
  _flicClient.addBatteryStatusListener(batteryStatus);
}

/**
 * Sends a battery update to the server.
 *
 * @param {String} bdAddr The bluetooth address.
 * @param {Number} value The battery percentage.
 */
function _sendBatteryUpdate(bdAddr, value) {
  if (value === -1) {
    log.verbose(LOG_PREFIX, 'Battery level unknown.');
    return;
  }
  const msg = `Battery for '${bdAddr}' is at ${value}%`;
  if (value > 75) {
    log.verbose(LOG_PREFIX, msg, value);
    return;
  }
  if (value > 50) {
    log.debug(LOG_PREFIX, msg, value);
    return;
  }
  let level;
  if (value > 25) {
    level = 'DEBUG';
    log.debug(LOG_PREFIX, msg, value);
  } else if (level > 15) {
    level = 'LOG';
    log.log(LOG_PREFIX, msg, value);
  } else if (level > 8) {
    level = 'WARN';
    log.warn(LOG_PREFIX, msg, value);
  } else {
    level = 'ERROR';
    log.error(LOG_PREFIX, msg, value);
  }

  // Throttle battery updates
  const now = Date.now();
  const msSinceUpdated = now - _flicButtons[bdAddr].battery.lastUpdated;
  if (msSinceUpdated < (15 * 60 * 1000)) {
    return;
  }
  _flicButtons[bdAddr].battery.lastUpdated = now;
  _flicButtons[bdAddr].battery.value = value;

  // Send battery update to server
  if (!_wsClient) {
    log.error(LOG_PREFIX, 'WebSocket client not available.');
    return;
  }
  const command = {
    actions: [
      {
        log: {
          level: level,
          sender: 'FLIC_APP',
          message: msg,
          extra: value,
        },
      },
    ],
  };
  _wsClient.send(JSON.stringify(command))
      .then(() => {
        log.verbose(LOG_PREFIX, `Command sent`, command);
      })
      .catch((err) => {
        log.error(LOG_PREFIX, `Unable to send command`, err);
      });
}

/**
 * Send a button press to the main server
 *
 * @param {String} address
 * @param {String} clickType
 * @param {Boolean} wasQueued
 * @param {Number} timeDiff
 */
function _sendButtonPress(address, clickType, wasQueued, timeDiff) {
  let msg = `buttonPressed(${address}, '${clickType}')`;
  const flicInfo = {address, clickType, wasQueued, timeDiff};
  // Verify app is not disabled
  if (_config.disabled) {
    log.log(LOG_PREFIX, `${msg} - Skipped: App is disabled.`);
    return;
  }

  // Verify we have a valid web socket client
  if (!_wsClient) {
    log.warn(LOG_PREFIX, `${msg} - Failed: wsClient not available.`);
    return;
  }

  // Get the key, based on the address
  const key = _config.lookup[address];
  if (!key) {
    log.warn(LOG_PREFIX, `${msg} - Failed: No key found for address.`);
    return;
  }
  flicInfo.key = key;

  msg = `buttonPressed('${key}', '${clickType}')`;

  // Get the details for the button
  const button = _config.commands[key];
  if (!button) {
    log.warn(LOG_PREFIX, `${msg} - Failed: No button found for key.`, flicInfo);
    return;
  }

  // Bail if the button is disabled
  if (button.disabled) {
    log.log(LOG_PREFIX, `${msg} - Skipped: Button is disabled.`, flicInfo);
    return;
  }

  // Get the command for the button based on the click type
  const command = button[clickType];
  if (!command) {
    log.log(LOG_PREFIX, `${msg} - Skipped: Click type not found.`, flicInfo);
    return;
  }
  command.flic = flicInfo;

  // Send the command
  log.log(LOG_PREFIX, `${msg}`, command);
  _wsClient.send(JSON.stringify(command))
      .then(() => {
        log.debug(LOG_PREFIX, `Command sent`, command);
      })
      .catch((err) => {
        log.error(LOG_PREFIX, `Unable to send command`, err);
      });
}

/**
 * Exit the app.
*/
function _close() {
  log.log(LOG_PREFIX, 'Preparing to exit, closing all connections...');
  if (_flicClient) {
    if (_flicScanner) {
      _flicClient.cancelScanWizard(_flicScanner);
    }
    _flicClient.close();
  }
  if (_wsClient) {
    _wsClient.shutdown();
  }
}

process.on('SIGINT', function() {
  log.log(LOG_PREFIX, 'SigInt received, shutting down...');
  _close();
  _deviceMonitor.shutdown('SIGINT', 'shutdown_request', 0);
});


init().catch((err) => {
  log.fatal(LOG_PREFIX, 'Init error', err);
});
