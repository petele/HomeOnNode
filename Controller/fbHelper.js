'use strict';

var Firebase = require('firebase');
var log = require('./SystemLog');
var moment = require('moment');
var exec = require('child_process').exec;

function init(key, appName, exit) {
  var timeFormat = 'YYYY-MM-DDTHH:mm:ss.SSS';
  var fb = new Firebase('https://boiling-torch-4633.firebaseio.com/');
  appName = appName.toLowerCase();

  fb.auth(key, function(error, authToken) {
    if (error) {
      log.error('[FIREBASE] Auth failed. ' + error.toString());
    } else {
      log.log('[FIREBASE] Auth success.');
      if (authToken) {
        log.debug('[FireBase] Auth Token: ' + JSON.stringify(authToken));
      }
    }
  });

  var startedAt = moment().format(timeFormat);
  var def = {
    'started_at': startedAt,
    'heartbeat': startedAt,
    'version': log.version,
    'online': true,
    'shutdown_at': null
  };
  fb.child('devices/' + appName).set(def);

  fb.child('.info/connected').on('value', function(snapshot) {
    if (snapshot.val() === true) {
      log.log('[NETWORK] Connected.');
      var def = {
        'heartbeat': moment().format(timeFormat),
        'online': true,
        'shutdown_at': null
      };
      fb.child('devices/' + appName).update(def);
      fb.child('devices/' + appName + '/online').onDisconnect().set(false);
      fb.child('devices/' + appName + '/shutdown_at').onDisconnect().set(Firebase.ServerValue.TIMESTAMP);
      //fb.child('devices/' + appName + '/started_at').onDisconnect().remove();
    } else {
      log.warn('[NETWORK] Disconnected.');
    }
  });

  setInterval(function() {
    fb.child('devices/' + appName + '/heartbeat').set(moment().format(timeFormat));
  }, 60000);

  log.initFirebase(fb, appName);

  fb.child('devices/' + appName + '/restart').on('value', function(snapshot) {
    if (snapshot.val() === true) {
      snapshot.ref().remove();
      var cmd = 'sudo reboot';
      exec(cmd, function(error, stdout, stderr) {
        
      });
      //exit('fbRestart', 10);
    }
  });

  fb.child('devices/' + appName + '/shutdown').on('value', function(snapshot) {
    if (snapshot.val() === true) {
      snapshot.ref().remove();
      exit('fbShutdown', 0);
    }
  });

  fb.child('devices/' + appName + '/logToFirebase').on('value', function(snapshot) {
    var result = false;
    if (snapshot.val() === true) {
      result = true;
    }
    log.enableFirebase(result);
    log.log('[APP] Firebase logging enabled: ' + result);
  });

  fb.child('devices/' + appName + '/debugLog').on('value', function(snapshot) {
    var result = false;
    if (snapshot.val() === true) {
      result = true;
    }
    log.enableDebug(result);
    log.log('[APP] Debug level logging enabled: ' + result);
  });

  return fb;
}

exports.init = init;
