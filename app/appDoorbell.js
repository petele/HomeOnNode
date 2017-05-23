'use strict';

const fs = require('fs');
const Gpio = require('onoff').Gpio;
const exec = require('child_process').exec;
const request = require('request');
const GCMPush = require('./GCMPush');
const log = require('./SystemLog2');
const fbHelper = require('./FBHelper');
const Keys = require('./Keys').keys;

let APP_NAME = 'REMOTE';
let fb;
let pin;
let config;
let gcmPush;
let lastPushed = 0;
let lastValue = 1;
const minTime = 3000;

const LOG_PREFIX = 'DOORBELL';
const logOpts = {
  logFileName: './logs/system.log',
  logToFile: true,
};

/**
 * Send a doorbell notification
*/
function sendDoorbell() {
  const url = `http://${config.controller.ip}:${config.controller.port}/doorbell`;
  const ring = {
    url: url,
    method: 'POST',
    json: true,
  };
  request(ring, function(error, response, body) {
    let msg = 'Ring Doorbell via ';
    if (error) {
      log.exception(LOG_PREFIX, msg + 'HTTP request failed.', error);
      if (fb) {
        fb.child('commands').send({cmdName: 'RUN_ON_DOORBELL'}, function(err) {
          if (err) {
            log.exception(LOG_PREFIX, msg + 'FB failed.', err);
            const cmd = 'sudo reboot';
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
    const gcmMessage = {
      title: 'Door Bell',
      body: 'The doorbell rang at',
      tag: 'HoN-doorbell',
      appendTime: true,
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
        const now = Date.now();
        const hasChanged = value !== lastValue ? true : false;
        const timeOK = now > lastPushed + minTime ? true : false;
        lastValue = value;
        if (hasChanged && timeOK && value === 0) {
          log.log(LOG_PREFIX, 'Ding-dong');
          lastPushed = now;
          sendDoorbell();
        } else {
          const msg = `v=${value} changed=${hasChanged} time=${timeOK}`;
          log.log(LOG_PREFIX, 'Debounced. ' + msg);
        }
      });
    }
  }
});

setInterval(function() {
  log.cleanFile(logOpts.logFileName);
}, 60 * 60 * 24 * 1000);

/**
 * Exit the app.
 *
 * @param {String} sender Who is requesting the app to exit.
 * @param {Number} exitCode The exit code to use.
*/
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
