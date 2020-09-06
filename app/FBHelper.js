'use strict';

/* node14_ready */

const Firebase = require('firebase/app');
require('firebase/auth');
require('firebase/database');
const log = require('./SystemLog2');
const Keys = require('./Keys').keys;
const honHelpers = require('./HoNHelpers');

const LOG_PREFIX = 'FB_HELPER';

let _initRequired = true;
let _fbApp;
let _fbDB;

/**
 * Attempt to autenticate with credentials.
 */
async function _login() {
  log.verbose(LOG_PREFIX, 'Starting Firebase auth...');
  const email = Keys.fbUser.email;
  const password = Keys.fbUser.password;
  try {
    await _fbApp.auth().signInWithEmailAndPassword(email, password);
    log.verbose(LOG_PREFIX, 'Firebase auth succeeded.');
  } catch (ex) {
    log.exception(LOG_PREFIX, 'Firebase auth failed.', ex);
    await honHelpers.sleep(5 * 1000);
    return _login();
  }
}

/**
 * Wait for the authentication to complete.
 *
 * @return {Promise<Boolean>} true once authenication has completed.
 */
async function _waitForAuth() {
  if (_initRequired) {
    log.init(LOG_PREFIX, `Initializing Firebase database...`);
    _fbApp = Firebase.initializeApp(Keys.fbConfig);
    _fbDB = _fbApp.database();
    _initRequired = false;
    _login();
    await honHelpers.sleep(250);
  }
  if (_fbApp.auth().currentUser) {
    return true;
  }
  await honHelpers.sleep(500);
  return _waitForAuth();
}

/**
 * Get a reference to a specific Firebase DB reference.
 *
 * @param {String} path Path to datastore
 * @return {Promise<database.ref>}
 */
async function _getRef(path) {
  if (!_fbApp || !_fbApp.currentUser) {
    await _waitForAuth();
  }
  log.verbose(LOG_PREFIX, `Retrieving Firebase database reference...`, path);
  return _fbDB.ref(path);
}

/**
 * Get the current FB Auth object
 *
 * @return {auth}
 */
function _getAuth() {
  return _fbApp.auth();
}

/**
 * Returns the authentication status.
 *
 * @return {Boolean}
 */
function _getAuthStatus() {
  if (_fbApp.auth().currentUser) {
    return true;
  }
  return false;
}

// init();

exports.getRef = _getRef;
exports.getAuth = _getAuth;
exports.waitForAuth = _waitForAuth;
exports.getAuthStatus = _getAuthStatus;

