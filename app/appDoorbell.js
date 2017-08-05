'use strict';

const fs = require('fs');
const log = require('./SystemLog2');
const Keys = require('./Keys').keys;
const GCMPush = require('./GCMPush');
const Firebase = require('firebase');
const WSClient = require('./WSClient');
const DeviceMonitor = require('./DeviceMonitor');

let GPIO;
const APP_NAME = 'DOORBELL';

let _fb;
let _pin;
let _config;
let _gcmPush;
let _wsClient;
let _lastPushed = 0;
let _lastValue = null;
let _deviceMonitor;
const MIN_TIME = 3000;

log.setAppName(APP_NAME);
log.setOptions({firebaseLogLevel: 50, firebasePath: 'logs/doorbell'});
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
    _deviceMonitor.restart();
  });
  _deviceMonitor.on('shutdown', () => {
    _exit('FB', 0);
  });

  if (loadGPIO() === false) {
    _exit('GPIO', 1);
    return;
  }

  _fb.child('config/Doorbell/logs').on('value', (snapshot) => {
    log.setOptions(snapshot.val());
    log.debug(APP_NAME, 'Log config updated.');
  });

  let data;
  try {
    log.debug(APP_NAME, `Reading 'config.json'.`);
    data = fs.readFileSync('config.json', {encoding: 'utf8'});
  } catch (ex) {
    log.exception(APP_NAME, `Error reading 'config.json' file.`, ex);
    _exit('read_config', 1);
    return;
  }

  try {
    log.debug(APP_NAME, `Parsing 'config.json'.`);
    _config = JSON.parse(data);
  } catch (ex) {
    log.exception(APP_NAME, `Error parsing 'config.json' file.`, ex);
    _exit('parse_config', 1);
    return;
  }

  if (_config.enabled !== true) {
    log.error(APP_NAME, 'Disabled by config.', _config);
    _exit('disabled_by_config', 1);
    return;
  }

  if (_config.hasOwnProperty('doorbellPin') === false) {
    log.error(APP_NAME, 'Doorbell pin not specified', _config);
    _exit('bad_config', 1);
    return;
  }

  _wsClient = new WSClient(_config.wsServer, true);
  _gcmPush = new GCMPush(_fb);
  _pin = new GPIO(_config.doorbellPin, 'in', 'both');
  _pin.watch(_pinChanged);
  setInterval(function() {
    log.cleanFile();
  }, 60 * 60 * 24 * 1000);
}

/**
 * Event handler for pin changed.
 *
 * @param {Object} err Error object
 * @param {Number} value New value
 */
function _pinChanged(err, value) {
  if (err) {
    log.error(APP_NAME, 'Error on pin changed', err);
  }
  const now = Date.now();
  const hasChanged = value !== _lastValue ? true : false;
  const timeOK = now > _lastPushed + MIN_TIME ? true : false;
  _lastValue = value;
  if (hasChanged && timeOK && value === 1) {
    _lastPushed = now;
    ringDoorbell();
    return;
  }
  // const msg = `v=${value} changed=${hasChanged} time=${timeOK}`;
  // log.debug(APP_NAME, 'Debounced. ' + msg);
}

/**
 * Loads the GPIO components
 *
 * @return {Boolean} true if loaded, false if not.
 */
function loadGPIO() {
  try {
    GPIO = require('onoff').Gpio;
    return true;
  } catch (ex) {
    log.exception(APP_NAME, 'Node module `onoff` is not available.', ex);
    return false;
  }
}

/**
 * Send a doorbell notification
*/
function ringDoorbell() {
  const doorbellCmd = {doorbell: true};
  const doorbellMsg = {
    title: 'Door Bell',
    body: 'The doorbell rang at',
    tag: 'HoN-doorbell',
    appendTime: true,
  };
  log.log(APP_NAME, 'Doorbell rang.');
  if (_wsClient) {
    _wsClient.send(JSON.stringify(doorbellCmd));
  }
  if (_gcmPush) {
    _gcmPush.sendMessage(doorbellMsg);
  }
}

/**
 * Exit the app.
 *
 * @param {String} sender Who is requesting the app to exit.
 * @param {Number} exitCode The exit code to use.
*/
function _exit(sender, exitCode) {
  exitCode = exitCode || 0;
  const details = {
    exitCode: exitCode,
    sender: sender,
  };
  log.log(APP_NAME, 'Starting shutdown process', details);
  if (_pin) {
    log.debug(APP_NAME, 'Unwatching pins');
    _pin.unwatchAll();
    log.debug(APP_NAME, 'Unexporting GPIO');
    _pin.unexport();
  }
  if (_wsClient) {
    _wsClient.shutdown();
  }
  if (_deviceMonitor) {
    _deviceMonitor.shutdown(sender);
  }
  setTimeout(function() {
    log.appStop(sender);
    process.exit(exitCode);
  }, 1500);
}

process.on('SIGINT', function() {
  _exit('SIGINT', 0);
});

init();
