'use strict';

var os = require('os');
var Firebase = require('firebase');
var exec = require('child_process').exec;
var Keys = require('./Keys').keys;
var log = require('./SystemLog2');

var fbURL = 'https://' + Keys.firebase.appId + '.firebaseio.com/';
var fb = new Firebase(fbURL);
var fbNode;
var deviceName = os.hostname();

var LOG_PREFIX = 'MONITOR';
var logOpts = {
  logFileName: './logs/system.log',
  logToFile: true
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

function fbReady() {
  fbNode = fb.child('monitor/' + deviceName);
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
  fbNode.child('reboot').on('value', rebootRequest);
  setInterval(heartbeat, 75 * 1000);
}

function heartbeat() {
  fbNode.child('heartbeat').set(Date.now());
}

function rebootRequest(snapshot) {
  if (snapshot.val() === true) {
    log.log(LOG_PREFIX, 'Reboot requested.');
    var cmd = 'sudo reboot';
    exec(cmd, function(error, stdout, stderr) {});
  }
}

setInterval(function() {
  log.cleanFile(logOpts.logFileName);
}, 60 * 60 * 24 * 1000);
