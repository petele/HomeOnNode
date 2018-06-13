/* eslint no-console: ["error", { "allow": ["error"] }] */

'use strict';

const fs = require('fs');
const log = require('./SystemLog2');
const Keys = require('./Keys').keys;
const Firebase = require('firebase');
const WSClient = require('./WSClient');
const DeviceMonitor = require('./DeviceMonitor');

const APP_NAME = 'HoN_FLIC';
const FB_LOG_PATH = `logs/${APP_NAME.toLowerCase()}`;

let _fb;
let _config;
let _wsClient;
let _deviceMonitor;
// let _hasReadFBConfig = false;

// Read config file
try {
  // eslint-disable-next-line no-console
  console.log(`Reading 'config.json'...`);
  let config = fs.readFileSync('config.json', {encoding: 'utf8'});
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
    _close();
    _deviceMonitor.restart('FB', 'restart_request', false);
  });
  _deviceMonitor.on('shutdown', () => {
    _close();
    _deviceMonitor.shutdown('FB', 'shutdown_request', 0);
  });

  // Initialize Flic API
  // TODO

  // Connect to the web socket server
  if (_config.wsServer) {
    _wsClient = new WSClient(_config.wsServer, true);
  }

  // Listen for changes to config
  _fb.child(`config/${APP_NAME}`).on('value', (snapshot) => {
    // if (_hasReadFBConfig === false) {
    //   _hasReadFBConfig = true;
    //   return;
    // }
    // const config = JSON.stringify(snapshot.val(), null, 2);
    // fs.writeFileSync('config.json', config, {encoding: 'utf8'});
    // log.log(APP_NAME, 'Config updated, restart required.');
    // _close();
    // _deviceMonitor.restart(APP_NAME, 'Config changed', false);
  });

  // Clean up logs every 24 hours
  setInterval(function() {
    log.cleanFile();
    log.cleanLogs(FB_LOG_PATH, 7);
  }, 60 * 60 * 24 * 1000);
}


/**
 * Exit the app.
*/
function _close() {
  log.log(APP_NAME, 'Preparing to exit, closing all connections...');
  if (_wsClient) {
    _wsClient.shutdown();
  }
}

process.on('SIGINT', function() {
  log.log(APP_NAME, 'SigInt received, shutting down...');
  _close();
  _deviceMonitor.shutdown('SIGINT', 'shutdown_request', 0);
});

init();
