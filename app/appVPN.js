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
const _connections = {};

const APP_NAME = 'VPNMonitor';
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
  log.init(LOG_PREFIX, `Setting up log watcher for: ${filename}`);
  try {
    fs.accessSync(filename, fs.R_OK);
  } catch (ex) {
    log.exception(LOG_PREFIX, `Unable to read '${filename}'`, ex);
    return;
  }
  _tail = new Tail(_config.fileToWatch);
  _tail.on('line', _handleLogLine);
  _tail.on('error', (err) => {
    log.exception(LOG_PREFIX, 'Error reading log file', err);
  });
}

const RE_START = /pppd\[(\d+)\]: pppd \d+?\.\d+?\.\d+? started by .+?, uid \d+?/;
const RE_USER = /pppd\[(\d+)\]: rcvd \[CHAP Response id=0x\w{2} <\w+?>, name = "(\w+?)"\]/;
const RE_SUCCESS = /pppd\[(\d+)\]: sent \[CHAP Success id=0x\w{2} "Access granted\"]/
const RE_TIME = /pppd\[(\d+)\]: Connect time (.*?) (.*?)\./
const RE_STATS = /pppd\[(\d+)\]: Sent (\d+) bytes, received (\d+) bytes/
const RE_DISCONNECT = /pppd\[(\d+)\]: Exit\./;

/**
 * Handle an incoming log line
 *
 * @param {String} line New log line to handle.
 */
function _handleLogLine(line) {
  try {
    let match;
    match = line.match(RE_START);
    if (match) {
      const pid = match[1];
      connection[pid].connectAt = Date.now();
      log.log(LOG_PREFIX, `pppd started: ${pid}`, line);
      return;
    }
    match = line.match(RE_USER);
    if (match) {
      const pid = match[1];
      const user = match[2];
      connection[pid].user = user;
      log.log(LOG_PREFIX, `Login attempt for ${user} on ${pid}`, line);
      return;
    }
    match = line.match(RE_SUCCESS);
    if (match) {
      const pid = match[1];
      connection[pid].success = true;
      log.log(LOG_PREFIX, `Login success for ${user} on ${pid}`, line);
      return;
    }
    match = line.match(RE_TIME);
    if (match) {
      const pid = match[1];
      const timeVal = match[2];
      const timeUnits = match[3];
      connection[pid].connectionLength = `${timeVal} ${timeUnits}`;
      log.log(LOG_PREFIX, `Connection time: ${timeVal} ${timeUnits} on ${pid}`, line);
      return;
    }
    match = line.match(RE_STATS);
    if (match) {
      const pid = match[1];
      const bytesSent = match[2];
      const bytesRecv = match[3];
      connection[pid].bytesSent = bytesSent;
      connection[pid].bytesRecv = bytesRecv;
      log.log(LOG_PREFIX, `Bytes sent: ${bytesSent} / received: ${bytesRecv} on ${pid}`, line);
      return;
    }
    match = line.match(RE_DISCONNECT);
    if (match) {
      const pid = match[1];
      log.log(LOG_PREFIX, `Disconnected: ${pid}`, line);
      log.log(LOG_PREFIX, 'Connection X', connection[pid]);
      connection[pid] = null;
      return;
    }
  } catch (ex) {
    const r = {
      line: line,
      ex: ex,
    };
    log.log(LOG_PREFIX, 'handleLogLine failed', r);
  }
}

process.on('SIGINT', function() {
  log.log(APP_NAME, 'SIGINT received.');
  _deviceMonitor.shutdown('SIGINT', 'shutdown_request', 0);
});

init();
