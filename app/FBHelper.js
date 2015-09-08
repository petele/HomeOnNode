'use strict';

var Firebase = require('firebase');
var log = require('./SystemLog');
var moment = require('moment');
var version = require('./version');
var exec = require('child_process').exec;

function init(fbAppId, key, appName) {
  var timeFormat = 'YYYY-MM-DDTHH:mm:ss.SSS';
  var fbURL = 'https://' + fbAppId + '.firebaseio.com/';
  var fb = new Firebase(fbURL);

  fb.authWithCustomToken(key, function(error, authToken) {
    if (error) {
      log.exception('[FIREBASE] Auth failed.', error);
    } else {
      log.log('[FIREBASE] Auth success.');
      if (authToken) {
        log.debug('[FIREBASE] Auth Token: ' + JSON.stringify(authToken));
      }
    }
  });

  var now = Date.now();
  var startedAt = moment(now).format(timeFormat);
  var def = {
    appName: appName,
    startedAt: now,
    startedAt_: startedAt,
    heartbeat: now,
    heartbeat_: startedAt,
    version: version.head,
    online: true,
    shutdownAt: null
  };
  fb.child('devices/' + appName).set(def);

  fb.child('.info/connected').on('value', function(snapshot) {
    if (snapshot.val() === true) {
      log.log('[NETWORK] Connected.');
      var now = Date.now();
      var def = {
        heartbeat: now,
        heartbeat_: moment(now).format(timeFormat),
        online: true,
        shutdownAt: null
      };
      fb.child('devices/' + appName).update(def);
      fb.child('devices/' + appName + '/online').onDisconnect().set(false);
      fb.child('devices/' + appName + '/shutdownAt')
        .onDisconnect().set(Firebase.ServerValue.TIMESTAMP);
    } else {
      log.warn('[NETWORK] Disconnected.');
    }
  });

  setInterval(function() {
    var now = Date.now();
    fb.child('devices/' + appName + '/heartbeat_')
      .set(moment(now).format(timeFormat));
    fb.child('devices/' + appName + '/heartbeat').set(now);
  }, 60000);

  fb.child('devices/' + appName + '/restart').on('value', function(snapshot) {
    if (snapshot.val() === true) {
      snapshot.ref().remove();
      log.appStop('[FIREBASE] Restart requested.');
      var cmd = 'sudo reboot';
      exec(cmd, function(error, stdout, stderr) {});
    }
  });

  fb.child('devices/' + appName + '/shutdown').on('value', function(snapshot) {
    if (snapshot.val() === true) {
      snapshot.ref().remove();
      log.appStop('[FIREBASE] Shutdown requested.');
      process.exit(0);
    }
  });

  return fb;
}

exports.init = init;
