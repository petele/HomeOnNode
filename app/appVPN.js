/* eslint no-console: ["error", { "allow": ["error"] }] */

'use strict';

const fs = require('fs');
const MyIP = require('./MyIP');
const Tail = require('tail').Tail;
const log = require('./SystemLog2');
const Keys = require('./Keys').keys;
const Firebase = require('firebase');
const DeviceMonitor = require('./DeviceMonitor');

let _fb;
let _tail;
let _myIP;
let _config;
let _deviceMonitor;

const APP_NAME = 'VPN_MONITOR';
const FB_LOG_PATH = `logs/${APP_NAME.toLowerCase()}`;
const LOG_PREFIX = 'VPN_LOG';

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

  _myIP = new MyIP(_config.googleDNS);
  _myIP.on('change', (ip) => {
    _fb.child(`config/${APP_NAME}/googleDNS/externalIP`).set(ip);
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
  log.init(VPN_LOG_PREFIX, `Setting up log watcher for: ${filename}`);
  try {
    fs.accessSync(filename, fs.R_OK);
  } catch (ex) {
    log.exception(VPN_LOG_PREFIX, `Unable to read '${filename}'`, ex);
    return;
  }
  _tail = new Tail(_config.fileToWatch);
  _tail.on('line', _handleLogLine);
  _tail.on('error', (err) => {
    log.exception(VPN_LOG_PREFIX, 'Error reading log file', err);
  });
}

/**
 * Handle an incoming log line
 *
 * @param {String} line New log line to handle.
 */
function _handleLogLine(line) {
  log.log(VPN_LOG_PREFIX, 'item received', line);
}

process.on('SIGINT', function() {
  log.log(APP_NAME, 'SIGINT received.');
  _deviceMonitor.shutdown('SIGINT', 'shutdown_request', 0);
});

init();
