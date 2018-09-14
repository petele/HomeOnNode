/* eslint no-console: ["error", { "allow": ["error"] }] */

'use strict';

const fs = require('fs');
const Tail = require('tail').Tail;
const log = require('./SystemLog2');
const Keys = require('./Keys').keys;
const Firebase = require('firebase');
const DeviceMonitor = require('./DeviceMonitor');

let _fb;
let _tail;
let _config;
let _deviceMonitor;

// Read config file
try {
  // eslint-disable-next-line no-console
  console.log(`Reading 'config.json'...`);
  const config = fs.readFileSync('config.json', {encoding: 'utf8'});
  // eslint-disable-next-line no-console
  console.log(`Parsing 'config.json'...`);
  _config = JSON.parse(config);
} catch (ex) {
  console.error(`Unable to read or parse 'config.json'`);
  console.error(ex);
  process.exit(1);
}

// Verify config has appName
if (!_config.appName) {
  console.error(`'appName' not set in config.`);
  process.exit(1);
}

const APP_NAME = _config.appName;
const FB_LOG_PATH = `logs/${APP_NAME.toLowerCase()}`;

// Setup logging
log.setAppName(APP_NAME);
log.setOptions({
  firebaseLogLevel: _config.logLevel || 50,
  firebasePath: FB_LOG_PATH,
});
log.startWSS();
log.appStart();

/**
 * Init
 */
function init() {
  _fb = new Firebase(`https://${Keys.firebase.appId}.firebaseio.com/`);
  _fb.authWithCustomToken(Keys.firebase.key, function(error, authToken) {
    if (error) {
      log.exception(APP_NAME, 'Firebase auth failed.', error);
    } else {
      log.log(APP_NAME, 'Firebase auth success.');
    }
  });
  log.setFirebaseRef(_fb);
  _deviceMonitor = new DeviceMonitor(_fb.child('devices'), APP_NAME);
  _deviceMonitor.on('restart_request', () => {
    _deviceMonitor.restart('FB', 'restart_request', false);
  });
  _deviceMonitor.on('shutdown_request', () => {
    _deviceMonitor.shutdown('FB', 'shutdown_request', 0);
  });
  _deviceMonitor.on('connection_timedout', () => {
    _deviceMonitor.restart('FB', 'connection_timedout', false);
  });

  _initWatcher(_config.fileToWatch);

  setInterval(function() {
    log.cleanFile();
    log.cleanLogs(FB_LOG_PATH, 90);
  }, 60 * 60 * 24 * 1000);
}

/**
 * Setup the log watcher
 *
 * @param {String} filename Filename to watch.
 */
function _initWatcher(filename) {
  if (!filename) {
    return;
  }
  log.log(APP_NAME, `Setting up log watcher for: ${filename}`);
  try {
    fs.accessSync(filename, fs.R_OK);
  } catch (ex) {
    log.exception(APP_NAME, `Unable to read '${filename}'`, ex);
    return;
  }
  _tail = new Tail(_config.fileToWatch);
  _tail.on('line', _handleLogLine);
  _tail.on('error', (err) => {
    log.exception(APP_NAME, 'Error reading log file', err);
  });
}

/**
 * Handle an incoming log line
 *
 * @param {String} line New log line to handle.
 */
function _handleLogLine(line) {
  log.log(APP_NAME, 'item received', line);
}

process.on('SIGINT', function() {
  log.log(APP_NAME, 'SIGINT received.');
  _deviceMonitor.shutdown('SIGINT', 'shutdown_request', 0);
});

init();
