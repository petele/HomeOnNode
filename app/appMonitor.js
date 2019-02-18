'use strict';

const os = require('os');
const Keys = require('./Keys').keys;
const log = require('./SystemLog2');
const Firebase = require('firebase');
const DeviceMonitor = require('./DeviceMonitor');

const LOG_PREFIX = 'MONITOR';

let _fb;
let _hostname;
let _deviceMonitor;

const logOpts = {
  consoleLogLevel: 20,
  firebaseLogLevel: 45,
  firebasePath: 'logs/monitor',
  fileLogLevel: 45,
  fileFilename: './logs/monitor.log',
};

log.setAppName(LOG_PREFIX);
log.setOptions(logOpts);
log.startWSS(8882);
log.appStart();

/**
 * Init
 */
function init() {
  _fb = new Firebase(`https://${Keys.firebase.appId}.firebaseio.com/`);
  _fb.authWithCustomToken(Keys.firebase.key, function(error, authToken) {
    if (error) {
      log.exception(LOG_PREFIX, 'Firebase auth failed.', error);
    } else {
      log.log(LOG_PREFIX, 'Firebase auth success.');
    }
  });
  log.setFirebaseRef(_fb);

  _hostname = os.hostname();
  if (_hostname.indexOf('.') >= 0) {
    _hostname = _hostname.substring(0, _hostname.indexOf('.'));
  }

  _deviceMonitor = new DeviceMonitor(_fb.child('monitor'), _hostname);
  _deviceMonitor.on('restart_request', () => {
    _deviceMonitor.restart('FB', 'restart_request', false);
  });
  _deviceMonitor.on('connection_timedout', () => {
    _deviceMonitor.restart('FB', 'connection_timedout', false);
  });

  setInterval(function() {
    log.cleanFile();
    log.cleanLogs(logOpts.firebasePath, 7);
  }, 60 * 60 * 24 * 1000);
}

process.on('SIGINT', function() {
  _deviceMonitor.shutdown('SIGINT', 'shutdown_request', 0);
});

init();
