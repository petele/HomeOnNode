'use strict';

var fs = require('fs');
var log = require('./SystemLog');
var fbHelper = require('./FBHelper');
var Keys = require('./Keys').keys;
var webRequest = require('./webRequest');
var Gpio = require('onoff').Gpio;

var APP_NAME = 'REMOTE';
var fb;
var pin;
var config;

var debounceTimer = null;
var debounceTimeout = 1500;

log.setLogFileName('./start.log');
log.setFileLogging(true);

function sendDoorbell() {
  if (debounceTimer) {
    log.warn('[sendDoorbell] Debounced.');
    return;
  }
  debounceTimer = setTimeout(function() {
    log.debug('[sendDoorbell] Debounce timer cleared.');
    debounceTimer = null;
  }, debounceTimeout);
  var uri = {
    host: config.controller.ip,
    port: config.controller.port,
    path: '/doorbell',
    method: 'POST'
  };
  try {
    webRequest.request(uri, null, function(resp) {
      log.http('Response', JSON.stringify(resp));
    });
  } catch (ex) {
    log.exception('[sendDoorbell] Failed', ex);
  }
}

fs.readFile('config.json', {'encoding': 'utf8'}, function(err, data) {
  if (err) {
    log.exception('Unable to open config file.', err);
  } else {
    config = JSON.parse(data);
    APP_NAME = config.appName;
    log.appStart(APP_NAME);
    fb = fbHelper.init(Keys.firebase.appId, Keys.firebase.key, APP_NAME);

    fb.child('config/' + APP_NAME + '/logs').on('value', function(snapshot) {
      var logSettings = snapshot.val();
      if (logSettings) {
        if (logSettings.logLevel === 'DEBUG') {
          log.setDebug(true);
        } else {
          log.setDebug(false);
        }
        if (logSettings.toFirebase === true) {
          log.setFirebase(fb);
        } else {
          log.setFirebase(null);
        }
        if (logSettings.toFilename) {
          log.setLogFileName(logSettings.toFilename);
        }
        if (logSettings.toFile === true) {
          log.setFileLogging(true);
        } else {
          log.setFileLogging(false);
        }
      }
    });

    if (config.doorbellPin) {
      pin = new Gpio(config.doorbellPin, 'in', 'rising');
      pin.watch(function(error, value) {
        if (error) {
          log.error('[DOORBELL] Error watching doorbell: ' + error);
        } else {
          log.log('[DOORBELL] Pushed');
          sendDoorbell();
        }
      });
    }
  }
});

function exit(sender, exitCode) {
  exitCode = exitCode || 0;
  log.log('[APP] Starting shutdown process');
  log.log('[APP] Will exit with error code: ' + String(exitCode));
  if (pin) {
    log.log('[APP] Unwatching pins');
    pin.unwatchAll();
    log.log('[APP] Unexporting GPIO');
    pin.unexport();
  }
  setTimeout(function() {
    log.appStop(sender);
    process.exit(exitCode);
  }, 1500);
}

process.on('SIGINT', function() {
  exit('SIGINT', 0);
});
