'use strict';

const os = require('os');
const Firebase = require('firebase');
const exec = require('child_process').exec;
const Keys = require('./Keys').keys;
const log = require('./SystemLog2');

const MAX_DISCONNECT = 60 * 60 * 6 * 1000;
const FB_URL = `https://${Keys.firebase.appId}.firebaseio.com/`;

const fb = new Firebase(FB_URL);
const deviceName = os.hostname();
const fbNode = fb.child('monitor/' + deviceName);
let fbHeartbeatTime;

const LOG_PREFIX = 'MONITOR';
const logOpts = {
  logFileName: './logs/system.log',
  logToFile: true,
};
log.appStart(deviceName, logOpts);

fb.authWithCustomToken(Keys.firebase.key, function(error, authToken) {
  if (error) {
    log.exception(LOG_PREFIX, 'Firebase auth failed.', error);
  } else {
    log.log(LOG_PREFIX, 'Firebase auth success.');
    fbReady();
  }
});

/**
 * Init.
*/
function fbReady() {
  fb.child('.info/connected').on('value', function(snapshot) {
    if (snapshot.val() === true) {
      log.log(LOG_PREFIX, 'Connected to Firebase');
      fbNode.child('alive').set(true);
      fbNode.child('alive').onDisconnect().set(false);
      fbNode.child('reboot').set(false);
      fbNode.child('reboot').onDisconnect().remove();
      fbNode.child('heartbeat').set(Date.now());
      fbNode.child('heartbeat').onDisconnect().remove();
      fbNode.child('offlineAt').remove();
      fbNode.child('offlineAt')
        .onDisconnect().set(Firebase.ServerValue.TIMESTAMP);
    } else {
      log.warn(LOG_PREFIX, 'Disconnected from Firebase');
    }
  });
  fbHeartbeatTime = Date.now();
  fbNode.child('reboot').on('value', rebootRequest);
  setInterval(heartbeat, 75 * 1000);
}

/**
 * Hearbeat tick.
*/
function heartbeat() {
  const lastConnection = (Date.now() - fbHeartbeatTime);
  if (lastConnection > MAX_DISCONNECT) {
    log.error(LOG_PREFIX, 'Firebase heartbeat timeout exceeded.');
    const cmd = 'sudo reboot';
    exec(cmd, function(error, stdout, stderr) {});
  } else {
    fbNode.child('heartbeat').set(Date.now(), function(err) {
      if (!err) {
        fbHeartbeatTime = Date.now();
      }
    });
  }
}

/**
 * Reboot the device.
 *
 * @param {Object} snapshot Firebase snapshot.
*/
function rebootRequest(snapshot) {
  if (snapshot.val() === true) {
    log.log(LOG_PREFIX, 'Reboot requested.');
    const cmd = 'sudo reboot';
    exec(cmd, function(error, stdout, stderr) {});
  }
}

setInterval(function() {
  log.cleanFile(logOpts.logFileName);
}, 60 * 60 * 24 * 1000);
