'use strict';

/* node14_ready */

const Firebase = require('firebase/app');
require('firebase/auth');
require('firebase/database');
const log = require('./SystemLog2');
const Keys = require('./Keys').keys;
const honHelpers = require('./HoNHelpers');

const LOG_PREFIX = 'FB_HELPER';

const AUTH_TIMEOUT = 9 * 1000;

let _fbApp;
let _fbDB;
let _fbRootRef;
let _isAuthInProgress = false;

/**
 * Initialize the Firebase App
 */
async function _initFBApp() {
  if (_fbApp) {
    return _fbApp;
  }
  log.verbose(LOG_PREFIX, 'Creating app...');
  _fbApp = await Firebase.initializeApp(Keys.fbConfig);
  return;
}

/**
 * Login and get the Firebase root ref, if auth fails, wait AUTH_TIMEOUT
 * then try again.
 */
async function _go() {
  _isAuthInProgress = true;
  log.verbose(LOG_PREFIX, 'Authenticating...');
  const email = Keys.fbUser.email;
  const password = Keys.fbUser.password;
  try {
    await _initFBApp();
    await _fbApp.auth().signInWithEmailAndPassword(email, password);
    log.verbose(LOG_PREFIX, 'Authentication succeeded.');
    _fbDB = _fbApp.database();
    _fbRootRef = _fbDB.ref();
    _isAuthInProgress = false;
    return _fbRootRef;
  } catch (ex) {
    log.error(LOG_PREFIX, 'Authentication failed, will retry.', ex);
    await honHelpers.sleep(AUTH_TIMEOUT);
    return _go();
  }
}

/**
 * Promise that rejects after MAX_TIMEOUT
 *
 * @param {Number} timeout Number of ms to wait until rejection.
 * @return {Promise}
 */
function _timer(timeout) {
  return new Promise((resolve, reject) => {
    setTimeout(() => {
      reject(new Error('Timeout exceeded.'));
    }, timeout);
  });
}

/**
 * Wait for authentication to complete, stop after MAX_TIMEOUT seconds.
 *
 * @param {Number} startedAt Time the loop was started.
 * @param {Number} timeout How long to wait before bailing.
 * @return {Promise<?database.reference>}
 */
async function _waitForFBRoot(startedAt, timeout) {
  if (_fbRootRef) {
    return _fbRootRef;
  }
  if (Date.now() - startedAt > timeout) {
    return null;
  }
  log.verbose(LOG_PREFIX, `Authentication in progress...`);
  await honHelpers.sleep(750);
  return _waitForFBRoot(startedAt, timeout);
}

/**
 * Get the Firebase root, wait forever
 */
async function _getFBRootRefUnlimited() {
  if (_fbRootRef) {
    return _fbRootRef;
  }
  if (_isAuthInProgress) {
    return _waitForFBRoot(Date.now(), Number.MAX_SAFE_INTEGER);
  }
  return _go();
}

/**
 * Get the Firebase root, if timeout is exceeded, fail.
 *
 * @param {Number} timeout
 */
async function _getFBRootRefWithTimeout(timeout) {
  if (!timeout) {
    throw new RangeError('No timeout provided');
  }
  if (_fbRootRef) {
    return _fbRootRef;
  }
  if (_isAuthInProgress) {
    return Promise.race([
      _waitForFBRoot(Date.now(), timeout),
      _timer(timeout),
    ]);
  }
  return Promise.race([_go(), _timer(timeout)]);
}

/**
 * Returns the Firebase Timestamp value.
 *
 * @return {Object}
 */
function _getServerTimeStamp() {
  return Firebase.database.ServerValue.TIMESTAMP;
}

exports.getRootRef = _getFBRootRefWithTimeout;
exports._getRootRefUnlimited = _getFBRootRefUnlimited;

exports.getServerTimeStamp = _getServerTimeStamp;
