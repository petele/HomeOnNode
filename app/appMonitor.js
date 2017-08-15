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
    _deviceMonitor.restart('FB', false);
  });
  _deviceMonitor.on('shutdown_request', () => {
    _exit('FB', 0);
  });
  _deviceMonitor.on('connection_timedout', () => {
    _deviceMonitor.restart('CNX_Timeout', false);
  });

  setInterval(function() {
    log.cleanFile(logOpts.fileFilename);
  }, 60 * 60 * 24 * 1000);
}

/**
 * Exit the app.
 *
 * @param {String} sender Who is requesting the app to exit.
 * @param {Number} [exitCode] The exit code to use.
*/
function _exit(sender, exitCode) {
  exitCode = exitCode || 0;
  const details = {
    exitCode: exitCode,
    sender: sender,
  };
  log.log(LOG_PREFIX, 'Starting shutdown process', details);
  if (_deviceMonitor) {
    _deviceMonitor.shutdown(sender);
  }
  setTimeout(function() {
    log.appStop(sender);
    process.exit(exitCode);
  }, 2500);
}

process.on('SIGINT', function() {
  _exit('SIGINT', 0);
});

init();
