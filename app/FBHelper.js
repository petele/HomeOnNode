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
const MAX_TIMEOUT = 30 * 1000;

let _fbApp;
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
    _fbRootRef = _fbApp.database().ref();
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
 * @return {Promise}
 */
function _timer() {
  return new Promise((resolve, reject) => {
    setTimeout(() => {
      reject(new Error('Timeout exceeded.'));
    }, MAX_TIMEOUT);
  });
}

/**
 * Wait for authentication to complete, stop after MAX_TIMEOUT seconds.
 *
 * @param {Number} startedAt Time the loop was started.
 * @return {Promise<?database.reference>}
 */
async function _waitForFBRoot(startedAt) {
  if (_fbRootRef) {
    return _fbRootRef;
  }
  const duration = Date.now() - startedAt;
  if (Date.now() - startedAt > MAX_TIMEOUT) {
    return null;
  }
  log.verbose(LOG_PREFIX, `Authentication in progress... ${duration/1000}`);
  await honHelpers.sleep(2 * 1000);
  return _waitForFBRoot(startedAt);
}

/**
 * Attempts to get the root reference, will fail after MAX_TIMEOUT.
 *
 * @return {Promise<?database.reference>}
 */
async function _getFBRootRef() {
  if (_fbRootRef) {
    return _fbRootRef;
  }
  if (_isAuthInProgress) {
    const startedAt = Date.now();
    return Promise.race([_waitForFBRoot(startedAt), _timer()]);
  }
  return Promise.race([_go(), _timer()]);
}

exports.getFBRootRef = _getFBRootRef;
