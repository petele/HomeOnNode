'use strict';

var fs = require('fs');
var log = require('./SystemLog');
var fbHelper = require('./FBHelper');
var Keys = require('./Keys').keys;
var webRequest = require('./webRequest');
// var Gpio = require('onoff').Gpio;
var exec = require('child_process').exec;

var APP_NAME = 'REMOTE';
var fb;
var pin;
var config;
var lastPushed = 0;
var lastValue = 1;
var minTime = 3000;

var registrationIds = [];

log.setLogFileName('./start.log');
log.setFileLogging(true);

function sendDoorbell() {
  var uri = {
    host: config.controller.ip,
    port: config.controller.port,
    path: '/doorbell',
    method: 'POST'
  };
  try {
    webRequest.request(uri, null, function(resp) {
      log.http('RESP', JSON.stringify(resp));
    });
  } catch (ex) {
    log.exception('[sendDoorbell] Failed', ex);
    if (fb) {
      var cmd = {
        cmdName: 'RUN_ON_DOORBELL'
      };
      fb.child('commands').push(cmd, function(err) {
        log.error('[sendDoorbell] FB send failed, rebooting!');
        var cmd = 'sudo reboot';
        exec(cmd, function(error, stdout, stderr) {});
      });
    }
  }
  try {
    if (registrationIds.length > 0) {
      var gcmUri = {
        host: 'android.googleapis.com',
        path: '/gcm/send',
        secure: true,
        method: 'POST',
        authorization: 'key=' + Keys.gcm.apiKey
      };
      var body = {
        registration_ids: registrationIds
      };
      webRequest.request(gcmUri, JSON.stringify(body), function(resp) {
        log.http('RESP', JSON.stringify(resp));
      });
    }
  } catch (ex) {
    log.exception('[sendDoorbell] GCM Failed', ex);
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

    fb.child('pushSubscribers').on('value', function(snapshot) {
      var keys = Object.keys(snapshot.val());
      registrationIds = keys;
      console.log('keys', keys);
      sendDoorbell();
    });

    if (config.doorbellPin) {
      // pin = new Gpio(config.doorbellPin, 'in', 'both');
      // pin.watch(function(error, value) {
      //   var now = Date.now();
      //   var hasChanged = value !== lastValue ? true : false;
      //   var timeOK = now > lastPushed + minTime ? true : false;
      //   lastValue = value;
      //   if (hasChanged && timeOK && value === 0) {
      //     log.log('[DOORBELL] Ding-dong');
      //     lastPushed = now;
      //     sendDoorbell();
      //   } else {
      //     var msg = '[DOORBELL] Debounced.';
      //     msg += ' value=' + value;
      //     msg += ' hasChanged=' + hasChanged;
      //     msg += ' timeOK=' + timeOK;
      //     log.log(msg);
      //   }
      // });
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
