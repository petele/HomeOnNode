'use strict';

var fs = require('fs');
var Gpio = require('onoff').Gpio;
var exec = require('child_process').exec;
var request = require('request');
var GCMPush = require('./GCMPush');
var log = require('./SystemLog');
var fbHelper = require('./FBHelper');
var Keys = require('./Keys').keys;
var moment = require('moment');

var APP_NAME = 'REMOTE';
var fb;
var pin;
var config;
var gcmPush;
var lastPushed = 0;
var lastValue = 1;
var minTime = 3000;

log.setLogFileName('./start.log');
log.setFileLogging(true);

function sendDoorbell() {
  var url = 'http://' + config.controller.ip + ':' + config.controller.port;
  url += '/doorbell';
  var ring = {
    url: url,
    method: 'POST',
    json: true
  };
  request(ring, function(error, response, body) {
    if (error) {
      log.exception('[sendDoorbell] Failed', error);
      if (fb) {
        fb.child('commands').send({cmdName: 'RUN_ON_DOORBELL'}, function(err) {
          log.exception('[sendDoorbell] Double fail!', err);
          var cmd = 'sudo reboot';
          exec(cmd, function() {});
        });
      }
    }
  });
  if (gcmPush) {
    var gcmMessage = {
      title: 'Door Bell',
      body: 'The doorbell rang at',
      tag: 'HoN-doorbell',
      appendTime: true
    };
    gcmPush.sendMessage(gcmMessage);
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

    gcmPush = new GCMPush(fb);

    if (config.doorbellPin) {
      pin = new Gpio(config.doorbellPin, 'in', 'both');
      pin.watch(function(error, value) {
        var now = Date.now();
        var hasChanged = value !== lastValue ? true : false;
        var timeOK = now > lastPushed + minTime ? true : false;
        lastValue = value;
        if (hasChanged && timeOK && value === 0) {
          log.log('[DOORBELL] Ding-dong');
          lastPushed = now;
          sendDoorbell();
        } else {
          var msg = '[DOORBELL] Debounced.';
          msg += ' value=' + value;
          msg += ' hasChanged=' + hasChanged;
          msg += ' timeOK=' + timeOK;
          log.log(msg);
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
