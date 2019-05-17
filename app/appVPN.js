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
      log.debug(APP_NAME, 'Firebase auth success.');
    }
  });
  log.setFirebaseRef(_fb);
  _deviceMonitor = new DeviceMonitor(_fb.child('devices'), APP_NAME);
  _deviceMonitor.on('restart_request', () => {
    _deviceMonitor.restart('FB', 'restart_request', false);
  });
  _deviceMonitor.on('shutdown_request', () => {
    _deviceMonitor.shutdown('FB', 'shutdown_request', false);
  });
  _deviceMonitor.on('connection_timedout', () => {
    _deviceMonitor.restart('FB', 'connection_timedout', false);
  });

  _myIP = new MyIP(_config.googleDNS);
  _myIP.on('change', (ip) => {
    _fb.child(`config/${APP_NAME}/googleDNS/externalIP`).set(ip);
  });

  if (_config.watchFile && _config.fileToWatch) {
    _initWatcher(_config.fileToWatch);
  } else {
    log.log(APP_NAME, 'Log Watcher disabled.');
  }

  setInterval(function() {
    log.cleanFile();
    log.cleanLogs(FB_LOG_PATH, 90);
  }, 60 * 60 * 24 * 1000);
}

const RE_PPPD_PID = /pppd\[(\d+)\]: /;
const RE_XL2TPD_PID = /xl2tpd\[(\d+?)\]: /;

/**
 * Setup the log watcher
 *
 * @param {String} filename Filename to watch.
 */
function _initWatcher(filename) {
  log.debug(LOG_PREFIX, `Setting up log watcher for: ${filename}`);
  try {
    fs.accessSync(filename, fs.R_OK);
  } catch (ex) {
    log.exception(LOG_PREFIX, `Unable to read '${filename}'`, ex);
    return;
  }
  _tail = new Tail(_config.fileToWatch);
  _tail.on('line', (line) => {
    let match = line.match(RE_PPPD_PID);
    if (match && match[1]) {
      _handlePPPLog(match[1], line);
      return;
    }
    match = line.match(RE_XL2TPD_PID);
    if (match && match[1]) {
      _handleXL2TPDLog(match[1], line);
      return;
    }
  });
  _tail.on('error', (err) => {
    log.exception(LOG_PREFIX, 'Error reading log file', err);
  });
}

/**
 * Saves a value to the connection log
 *
 * @param {String} pid PPPD pid.
 * @param {String} prop Property to set.
 * @param {String} value Value to set on the property.
 * @return {Object} The connection object for the specified PID.
 */
function _setConnectionProperty(pid, prop, value) {
  let connection = _connections[pid];
  if (!connection) {
    connection = {};
    _connections[pid] = connection;
  }
  connection[prop] = value;
  return connection;
}

/* eslint-disable max-len */
const RE_START = /pppd\[(\d+)\]: pppd \d+?\.\d+?\.\d+? started by .+?, uid \d+?/;
const RE_USER = /pppd\[(\d+)\]: rcvd \[CHAP Response id=0x\w{2} <\w+?>, name = "(\w+?)"\]/;
const RE_SUCCESS = /pppd\[(\d+)\]: sent \[CHAP Success id=0x\w{2} "Access granted"]/;
const RE_TIME = /pppd\[(\d+)\]: Connect time (.*?) (.*?)\./;
const RE_STATS = /pppd\[(\d+)\]: Sent (\d+) bytes, received (\d+) bytes/;
const RE_DISCONNECT = /pppd\[(\d+)\]: Exit\./;
/* eslint-enable max-len */

/**
 * Handle an incoming log line
 *
 * @param {String} pid The pid of the PPPD process.
 * @param {String} line New log line to handle.
 */
function _handlePPPLog(pid, line) {
  const prefix = `PPPD_${pid}`;
  const now = Date.now();
  const nowPretty = new Date();
  try {
    let match = line.match(RE_START);
    if (match) {
      _setConnectionProperty(pid, 'connectedAt', now);
      _setConnectionProperty(pid, 'connectedAt_', nowPretty);
      log.debug(prefix, `Started pppd`, line);
      return;
    }
    match = line.match(RE_USER);
    if (match) {
      const user = match[2];
      _setConnectionProperty(pid, 'user', user);
      _setConnectionProperty(pid, 'loginSuccess', false);
      log.debug(prefix, `Login for: '${user}'`, line);
      return;
    }
    match = line.match(RE_SUCCESS);
    if (match) {
      const connection = _setConnectionProperty(pid, 'loginSuccess', true);
      const user = connection['user'];
      log.log(prefix, `Connected: '${user}'`, connection);
      return;
    }
    match = line.match(RE_TIME);
    if (match) {
      const timeVal = match[2];
      const timeUnits = match[3];
      const connectionLength = `${timeVal} ${timeUnits}`;
      _setConnectionProperty(pid, 'connectionTime', connectionLength);
      const msg = `Connection time: ${timeVal} ${timeUnits}`;
      log.debug(prefix, msg, line);
      return;
    }
    match = line.match(RE_STATS);
    if (match) {
      const bytesSent = match[2];
      const bytesRecv = match[3];
      _setConnectionProperty(pid, 'bytesSent', bytesSent);
      _setConnectionProperty(pid, 'bytesRecv', bytesRecv);
      log.debug(prefix, `Sent: ${bytesSent} bytes`, line);
      log.debug(prefix, `Received: ${bytesRecv} bytes`, line);
      return;
    }
    match = line.match(RE_DISCONNECT);
    if (match) {
      _setConnectionProperty(pid, 'disconnectedAt_', nowPretty);
      const connection = _setConnectionProperty(pid, 'disconnectedAt', now);
      const msg = `Disconnected: '${connection['user']}'`;
      log.log(prefix, msg, connection);
      _connections[pid] = null;
      return;
    }
  } catch (ex) {
    log.exception(prefix, '_handlePPPLog error', ex);
    log.exception(prefix, '_handlePPPLog error', line);
  }
}

/* eslint-disable max-len */
const RE_CNX_ESTABLISHED = /xl2tpd\[\d+?\]: Connection established to (.*?), (\d+?)\./;
const RE_CALL_ESTABLISHED = /xl2tpd\[\d+?\]: Call established with (.*?),/;
const RE_CNX_CLOSED = /xl2tpd\[\d+?\]: control_finish: Connection closed to (.*?),/;
const RE_CNX_TERMINATED = /xl2tpd\[\d+?\]: Terminating pppd: sending TERM signal to pid (\d+?)$/;
/* eslint-enable max-len */

/**
 * Handle an incoming log line
 *
 * @param {String} pid The pid of the XL2TPD process.
 * @param {String} line New log line to handle.
 */
function _handleXL2TPDLog(pid, line) {
  const prefix = `XL2TPD_${pid}`;
  try {
    let match = line.match(RE_CNX_ESTABLISHED);
    if (match) {
      log.log(prefix, `Connection established to ${match[1]}.`, line);
      return;
    }
    match = line.match(RE_CALL_ESTABLISHED);
    if (match) {
      log.log(prefix, `Call established with ${match[1]}.`, line);
      return;
    }
    match = line.match(RE_CNX_CLOSED);
    if (match) {
      log.log(prefix, `Connection to ${match[1]} closed.`, line);
      return;
    }
    match = line.match(RE_CNX_TERMINATED);
    if (match) {
      log.log(prefix, `Terminated PPP daemon id: ${match[1]}.`, line);
      return;
    }
  } catch (ex) {
    log.exception(prefix, '_handleXL2TPDLog error', ex);
    log.exception(prefix, '_handleXL2TPDLog error', line);
  }
}


process.on('SIGINT', function() {
  log.log(APP_NAME, 'SIGINT received.');
  _deviceMonitor.shutdown('SIGINT', 'shutdown_request', 0);
});

init();
