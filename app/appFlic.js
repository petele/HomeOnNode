/* eslint no-console: ["error", { "allow": ["error"] }] */

'use strict';

const fs = require('fs');
const log = require('./SystemLog2');
const Keys = require('./Keys').keys;
const Firebase = require('firebase');
const WSClient = require('./WSClient');
const DeviceMonitor = require('./DeviceMonitor');

const FlicLib = require('./FlicLib/FlicLibNodeJS');
const FlicClient = FlicLib.FlicClient;
const FlicScanWizard = FlicLib.FlicScanWizard;
const FlicConnectionChannel = FlicLib.FlicConnectionChannel;
const FlicBatteryStatusListener = FlicLib.FlicBatteryStatusListener;

const MODE = process.argv[2] === 'scan' ? 'SCAN' : 'LISTEN';
const APP_NAME = 'FlicController';
const FB_LOG_PATH = `logs/${APP_NAME.toLowerCase()}`;
const FLIC_CNX_OPTS = {
  autoDisconnectTime: 15,
  latencyMode: 'LowLatency',
};

let _fb;
let _config;
let _wsClient;
let _deviceMonitor;

let _flicClient;
let _flicScanner;

// Read config file
try {
  // eslint-disable-next-line no-console
  console.log(`Reading 'config.json'...`);
  let config = fs.readFileSync('config.json', {encoding: 'utf8'});
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
  firebasePath: FB_LOG_PATH,
});
log.startWSS();
log.appStart();

/**
 * Init
 */
function init() {
  _fb = new Firebase(`https://${Keys.firebase.appId}.firebaseio.com/`);
  _fb.authWithCustomToken(Keys.firebase.key, function(error, authToken) {
    if (error) {
      log.exception(APP_NAME, 'Firebase auth failed.', error);
    } else {
      log.log(APP_NAME, 'Firebase auth success.');
    }
  });
  log.setFirebaseRef(_fb);
  _deviceMonitor = new DeviceMonitor(_fb.child('devices'), APP_NAME);
  _deviceMonitor.on('restart_request', () => {
    _close();
    _deviceMonitor.restart('FB', 'restart_request', false);
  });
  _deviceMonitor.on('shutdown', () => {
    _close();
    _deviceMonitor.shutdown('FB', 'shutdown_request', 0);
  });

  // Connect to the web socket server
  if (_config.wsServer) {
    _wsClient = new WSClient(_config.wsServer, true, 'server');
  }

  // Listen for changes to config
  _fb.child(`config/${APP_NAME}`).on('value', (snapshot) => {
    log.log(APP_NAME, `Config changed, updating 'config.json'`);
    const config = JSON.stringify(snapshot.val(), null, 2);
    fs.writeFileSync('config.json', config, {encoding: 'utf8'});
  });

  // Listen for changes to config commands
  _fb.child(`config/${APP_NAME}/commands`).on('value', (snapshot) => {
    log.log(APP_NAME, 'Commands updated');
    _config.commands = snapshot.val();
  });

  // Listen for changes to disabled
  _fb.child(`config/${APP_NAME}/disabled`).on('value', function(snapshot) {
    _config.disabled = snapshot.val();
    log.log(APP_NAME, `'disabled' changed to '${_config.disabled}'`);
  });

  // Listen for changes to log level
  _fb.child(`config/${APP_NAME}/logLevel`).on('value', (snapshot) => {
    const logLevel = snapshot.val();
    log.setOptions({
      firebaseLogLevel: logLevel || 50,
      firebasePath: FB_LOG_PATH,
    });
    log.log(APP_NAME, `Log level changed to ${logLevel}`);
  });

  // Initialize Flic API
  _initFlic();

  // Clean up logs every 24 hours
  setInterval(function() {
    log.cleanFile();
    log.cleanLogs(FB_LOG_PATH, 7);
  }, 60 * 60 * 24 * 1000);
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
  log.init(APP_NAME, `Starting Flic client on ${host}:${port}`);
  _flicClient = new FlicClient(host, port);
  _flicClient.on('close', (hadError) => {
    if (hadError) {
      log.exception(APP_NAME, 'Flic client closed with error', hadError);
    } else {
      log.log(APP_NAME, 'Flic client closed.');
    }
    _close();
  });
  _flicClient.on('error', (error) => {
    log.exception(APP_NAME, 'Flic client error', error);
  });
  _flicClient.on('bluetoothControllerStateChange', (state) => {
    log.log(APP_NAME, `BlueTooth controller state changed to: ${state}`);
  });
  _flicClient.on('newVerifiedButton', (bdAddr) => {
    log.log(APP_NAME, `New button found at ${bdAddr}`);
    _listenToButton(bdAddr);
  });
  _flicClient.once('ready', () => {
    log.log(APP_NAME, 'Flic client ready');
    if (MODE === 'SCAN') {
      _startScanWizard();
      return;
    }
    _flicClient.getInfo((info) => {
      log.log(APP_NAME, `Flic client info`, info);
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
  log.log(APP_NAME, 'Scan started, press Flic button to add it.');
  _flicScanner = new FlicScanWizard();
  _flicScanner.on('foundPrivateButton', () => {
    const msg = 'Found private button, hold for 7 seconds to make it public.';
    log.warn(APP_NAME, msg);
  });
  _flicScanner.on('foundPublicButton', (bdAddr, name) => {
    const msg = `Found button '${name}' (${bdAddr}). Now connecting...`;
    log.log(APP_NAME, msg);
  });
  _flicScanner.on('buttonConnected', (bdAddr, name) => {
    const msg = `Connected to '${name}' (${bdAddr}). Verifying & pairing...`;
    log.log(APP_NAME, msg);
  });
  _flicScanner.on('completed', (result, bdAddr, name) => {
    if (result === 'WizardSuccess') {
      const msg = `Success! Button '${name}' (${bdAddr}) was added.`;
      log.log(APP_NAME, msg);
      return;
    }
    const msg = `Problem adding '${name}' (${bdAddr}) - ${result}`;
    log.warn(APP_NAME, msg);
  });
  _flicClient.addScanWizard(_flicScanner);
}

/**
 * Register a button and listen for presses
 *
 * @param {String} bdAddr
 */
function _listenToButton(bdAddr) {
  log.log(APP_NAME, `Listening for button: ${bdAddr}`);
  const cc = new FlicConnectionChannel(bdAddr, FLIC_CNX_OPTS);
  cc.on('connectionStatusChanged', (status, disconnectReason) => {
    const msg = `connectionStatusChanged for ${bdAddr} to ${status}`;
    log.log(APP_NAME, msg, disconnectReason);
  });
  cc.on('removed', (reason) => {
    log.warn(APP_NAME, `Button ${bdAddr} was removed because ${reason}`);
  });
  cc.on('buttonSingleOrDoubleClickOrHold', (clickType, wasQueued, timeDiff) => {
    const obj = {bdAddr, clickType, wasQueued, timeDiff};
    log.debug(APP_NAME, `Button '${bdAddr}' was ${clickType}`, obj);
    _sendButtonPress(bdAddr, clickType, wasQueued, timeDiff);
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
    log.verbose(APP_NAME, 'Battery level unknown.');
    return;
  }
  const msg = `Battery for ${bdAddr}: ${value}`;
  if (value > 75) {
    log.verbose(APP_NAME, msg, value);
    return;
  }
  if (value > 50) {
    log.debug(APP_NAME, msg, value);
    return;
  }
  let level;
  if (value > 25) {
    level = 'LOG';
    log.log(APP_NAME, msg, value);
  } else if (level > 10) {
    level = 'WARN';
    log.warn(APP_NAME, msg, value);
  } else {
    level = 'ERROR';
    log.error(APP_NAME, msg, value);
  }
  if (!_wsClient) {
    log.error(APP_NAME, 'WebSocket client not available.');
    return;
  }
  const command = {
    actions: [{log: {
        level: level,
        sender: 'FLIC',
        message: msg,
        extra: value,
      },
    }],
  };
  _wsClient.send(JSON.stringify(command))
    .then(() => {
      log.verbose(APP_NAME, `Command sent`, command);
    })
    .catch((err) => {
      log.error(APP_NAME, `Unable to send command`, err);
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
  if (_config.disabled === true) {
    log.warn(APP_NAME, `Command not sent, ${APP_NAME} is disabled.`);
    return;
  }
  if (!_wsClient) {
    log.warn(APP_NAME, `wsClient not available, command not sent.`);
    return;
  }
  if (!_config.commands || !_config.commands[address]) {
    log.error(APP_NAME, `No commands found for ${address}`);
    return;
  }
  const cmdsForAddr = _config.commands[address];
  const command = cmdsForAddr[clickType];
  if (!command) {
    log.debug(APP_NAME, `No command found for ${clickType} on ${address}`);
    return;
  }
  command.flic = {address, clickType, wasQueued, timeDiff};
  log.log(APP_NAME, `Sending command`, command);
  _wsClient.send(JSON.stringify(command))
    .then(() => {
      log.debug(APP_NAME, `Command sent`, command);
    })
    .catch((err) => {
      log.error(APP_NAME, `Unable to send command`, err);
    });
}

/**
 * Exit the app.
*/
function _close() {
  log.log(APP_NAME, 'Preparing to exit, closing all connections...');
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
  log.log(APP_NAME, 'SigInt received, shutting down...');
  _close();
  _deviceMonitor.shutdown('SIGINT', 'shutdown_request', 0);
});

init();
