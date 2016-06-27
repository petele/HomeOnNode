'use strict';

var fs = require('fs');
var Gpio = require('onoff').Gpio;
var exec = require('child_process').exec;
var request = require('request');
var GCMPush = require('./GCMPush');
var log = require('./SystemLog2');
var fbHelper = require('./FBHelper');
var Keys = require('./Keys').keys;

var APP_NAME = 'REMOTE';
var fb;
var pin;
var config;
var gcmPush;
var lastPushed = 0;
var lastValue = 1;
var minTime = 3000;

var LOG_PREFIX = 'DOORBELL';
var logOpts = {
  logFileName: './logs/system.log',
  logToFile: true
};

function sendDoorbell() {
  var url = 'http://' + config.controller.ip + ':' + config.controller.port;
  url += '/doorbell';
  var ring = {
    url: url,
    method: 'POST',
    json: true
  };
  request(ring, function(error, response, body) {
    var msg = 'Ring Doorbell via ';
    if (error) {
      log.exception(LOG_PREFIX, msg + 'HTTP request failed.', error);
      if (fb) {
        fb.child('commands').send({cmdName: 'RUN_ON_DOORBELL'}, function(err) {
          if (err) {
            log.exception(LOG_PREFIX, msg + 'FB failed.', err);
            var cmd = 'sudo reboot';
            exec(cmd, function() {});
            return;
          } else {
            log.warn(LOG_PREFIX, 'Worked via Firebase');
            return;
          }
        });
      }
    }
    log.log(LOG_PREFIX, 'Doorbell rang.');
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
    log.exception(LOG_PREFIX, 'Unable to open config file.', err);
  } else {
    config = JSON.parse(data);
    APP_NAME = config.appName;
    log.appStart(APP_NAME, logOpts);
    fb = fbHelper.init(Keys.firebase.appId, Keys.firebase.key, APP_NAME);

    gcmPush = new GCMPush(fb);

    if (config.doorbellPin) {
      pin = new Gpio(config.doorbellPin, 'in', 'both');
      pin.watch(function(error, value) {
        var now = Date.now();
        var hasChanged = value !== lastValue ? true : false;
        var timeOK = now > lastPushed + minTime ? true : false;
        lastValue = value;
        if (hasChanged && timeOK && value === 0) {
          log.log(LOG_PREFIX, 'Ding-dong');
          lastPushed = now;
          sendDoorbell();
        } else {
          var msg = 'Debounced.';
          msg += ' value=' + value;
          msg += ' hasChanged=' + hasChanged;
          msg += ' timeOK=' + timeOK;
          log.log(LOG_PREFIX, msg);
        }
      });
    }
  }
});

setInterval(function() {
  log.cleanFile(logOpts.logFileName);
}, 60 * 60 * 24 * 1000);

function exit(sender, exitCode) {
  exitCode = exitCode || 0;
  log.log(LOG_PREFIX, 'Starting shutdown process');
  log.log(LOG_PREFIX, 'Will exit with exit code: ' + String(exitCode));
  if (pin) {
    log.log(LOG_PREFIX, 'Unwatching pins');
    pin.unwatchAll();
    log.log(LOG_PREFIX, 'Unexporting GPIO');
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
