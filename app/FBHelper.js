'use strict';

var os = require('os');
var Firebase = require('firebase');
var log = require('./SystemLog2');
var moment = require('moment');
var version = require('./version');
var exec = require('child_process').exec;

var LOG_PREFIX = 'FIREBASE';

function init(fbAppId, key, appName) {
  log.init(LOG_PREFIX, fbAppId + ' for ' + appName);
  var timeFormat = 'YYYY-MM-DDTHH:mm:ss.SSS';
  var fbURL = 'https://' + fbAppId + '.firebaseio.com/';
  var fb = new Firebase(fbURL);

  fb.authWithCustomToken(key, function(error, authToken) {
    if (error) {
      log.exception(LOG_PREFIX, 'Firebase auth failed.', error);
    } else {
      log.log(LOG_PREFIX, 'Firebase auth success.', authToken);
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
    shutdownAt: null,
    host: {
      hostname: null,
      ipAddress: null,
    }
  };

  try {
    var hostname = os.hostname();
    log.log('NETWORK', 'Hostname: ' + hostname);
    def.host.hostname = hostname;
  } catch (ex) {
    log.exception('NETWORK', 'Unable to retrieve hostname.', ex);
  }
  try {
    var addresses = [];
    var interfaces = os.networkInterfaces();
    for (var k in interfaces) {
      for (var k2 in interfaces[k]) {
        var address = interfaces[k][k2];
        if (address.family === 'IPv4' && !address.internal) {
          addresses.push(address.address);
        }
      }
    }
    if (addresses.length === 0) {
      log.error('NETWORK', 'Whoops, 0 IP addresses returned');
    } else if (addresses.length === 1) {
      def.host.ipAddress = addresses[0];
      log.log('NETWORK', 'IP address: ' + addresses[0]);
    } else {
      def.host.ipAddress = addresses[0];
      var msg = 'Multiple IP addresses returned. Using: ' + addresses[0];
      log.log('NETWORK', msg, addresses);
    }
  } catch (ex) {
    log.exception('NETWORK', 'Unable to get local device IP addresses', ex);
  }

  fb.child('devices/' + appName).set(def);

  fb.child('.info/connected').on('value', function(snapshot) {
    if (snapshot.val() === true) {
      log.log(LOG_PREFIX, 'Connected.');
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
      log.warn(LOG_PREFIX, 'Disconnected.');
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
      log.appStop(LOG_PREFIX, 'Restart requested via Firebase.');
      var cmd = 'sudo reboot';
      exec(cmd, function(error, stdout, stderr) {});
    }
  });

  fb.child('devices/' + appName + '/shutdown').on('value', function(snapshot) {
    if (snapshot.val() === true) {
      snapshot.ref().remove();
      log.appStop(LOG_PREFIX, 'Shutdown requested via Firebase.');
      process.exit(0);
    }
  });

  return fb;
}

exports.init = init;
