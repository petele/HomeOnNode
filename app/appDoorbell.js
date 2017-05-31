'use strict';

const fs = require('fs');
const exec = require('child_process').exec;
const request = require('request');
const GCMPush = require('./GCMPush');
const log = require('./SystemLog2');
const fbHelper = require('./FBHelper');
const Keys = require('./Keys').keys;
let GPIO;

let APP_NAME = 'DOORBELL';
let _fb;
let _pin;
let _config;
let _gcmPush;
let _lastPushed = 0;
let _lastValue = 1;
const MIN_TIME = 3000;
const GCM_DOORBELL_MSG = {
  title: 'Door Bell',
  body: 'The doorbell rang at',
  tag: 'HoN-doorbell',
  appendTime: true,
};

log.setAppName(APP_NAME);
log.setOptions({firebaseLogLevel: 50, firebasePath: 'logs/doorbell'});
log.appStart();

try {
  GPIO = require('onoff').GPIO;
} catch (ex) {
  log.exception(APP_NAME, 'Node module `onoff` is not available.', ex);
  exit('GPIO', 1);
  return;
}

_fb = fbHelper.init(Keys.firebase.appId, Keys.firebase.key, APP_NAME);
log.setFirebaseRef(_fb);
_fb.child('config/Doorbell/logs').on('value', (snapshot) => {
  log.setOptions(snapshot.val());
  log.debug(APP_NAME, 'Log config updated.');
});

/**
 * Send an HTTP Request to the server
 *
 * @param {String} path
 * @param {String} method
 * @param {Object} [body]
 * @return {Promise}
 */
function sendHTTPRequest(path, method, body) {
  return new Promise(function(resolve, reject) {
    const requestHost = `${_config.controller.ip}:${_config.controller.port}`;
    const requestURL = `http://${requestHost}/${path}`;
    method = method || 'POST';
    const msg = `sendHTTPRequest('${path}', '${method}', ...)`;
    let requestOptions = {
      url: requestURL,
      method: method,
      json: true,
    };
    if (body) {
      requestOptions.body = body;
    }
    log.debug(APP_NAME, msg);
    request(requestOptions, function(error, response, body) {
      if (error) {
        log.exception(APP_NAME, msg + ' - failed.', error);
        reject(error);
        return;
      }
      resolve(body);
    });
  });
}

/**
 * Send a command to the server via Firebase
 *
 * @param {Object} cmd
 * @return {Promise}
 */
function sendCommandViaFB(cmd) {
  return new Promise(function(resolve, reject) {
    const msg = `sendCommandViaFB(${JSON.stringify(cmd)})`;
    log.debug(APP_NAME, msg);
    if (!_fb) {
      reject(new Error('Firebase not available.'));
      return;
    }
    _fb.child('commands').push(cmd, function(error) {
      if (error) {
        log.exception(APP_NAME, msg + ' - failed.', error);
        reject(error);
      }
      resolve(true);
    });
  });
}

/**
 * Send a doorbell notification
*/
function sendDoorbell() {
  log.log(APP_NAME, 'Doorbell rang.');
  sendHTTPRequest('doorbell', 'POST')
    .catch((err) => {
      return sendCommandViaFB({cmdName: 'RUN_ON_DOORBELL'});
    })
    .catch((err) => {
      log.error(APP_NAME, 'Attempt to send twice & failed, rebooting');
      exec('sudo reboot', function() {});
      return false;
    })
    .then(() => {
      if (!_gcmPush) {
        return Promise.reject(new Error('GCM Unavailable.'));
      }
      return _gcmPush.sendMessage(GCM_DOORBELL_MSG);
    });
}

fs.readFile('config.json', {'encoding': 'utf8'}, function(err, data) {
  if (err) {
    log.exception(APP_NAME, 'Unable to open config file.', err);
    exit('INIT', 1);
    return;
  }
  try {
    _config = JSON.parse(data);
  } catch (ex) {
    log.exception(APP_NAME, 'Unable to parse config file.', ex);
    exit('INIT', 1);
    return;
  }
  if (!_config.hasOwnProperty('doorbellPin')) {
    log.error(APP_NAME, '`doorbellPin` not set.');
    exit('INIT', 1);
    return;
  }
  _gcmPush = new GCMPush(_fb);
  _pin = new GPIO(_config.doorbellPin, 'in', 'both');
  _pin.watch(function(error, value) {
    const now = Date.now();
    const hasChanged = value !== _lastValue ? true : false;
    const timeOK = now > _lastPushed + MIN_TIME ? true : false;
    _lastValue = value;
    if (hasChanged && timeOK && value === 0) {
      _lastPushed = now;
      sendDoorbell();
    } else {
      const msg = `v=${value} changed=${hasChanged} time=${timeOK}`;
      log.debug(APP_NAME, 'Debounced. ' + msg);
    }
  });
});

setInterval(function() {
  log.cleanFile();
}, 60 * 60 * 24 * 1000);

/**
 * Exit the app.
 *
 * @param {String} sender Who is requesting the app to exit.
 * @param {Number} exitCode The exit code to use.
*/
function exit(sender, exitCode) {
  exitCode = exitCode || 0;
  log.log(APP_NAME, 'Starting shutdown process');
  log.log(APP_NAME, 'Will exit with exit code: ' + String(exitCode));
  if (_pin) {
    log.debug(APP_NAME, 'Unwatching pins');
    _pin.unwatchAll();
    log.debug(APP_NAME, 'Unexporting GPIO');
    _pin.unexport();
  }
  setTimeout(function() {
    log.appStop(sender);
    process.exit(exitCode);
  }, 1500);
}

process.on('SIGINT', function() {
  exit('SIGINT', 0);
});
