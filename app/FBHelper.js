'use strict';

/* node14_ready */

const Firebase = require('firebase/app');
require('firebase/auth');
require('firebase/database');
const log = require('./SystemLog2');
const Keys = require('./Keys').keys;

const LOG_PREFIX = 'FB_HELPER';

let _fbApp = null;
let _fbAuth = null;
let _fbDB = null;

/**
 * Gets the default Firebase App.
 *
 * @return {?Promise<app>}
 */
async function _getApp() {
  if (_fbApp) {
    return _fbApp;
  }
  const email = Keys.fbUser.email;
  const password = Keys.fbUser.password;
  try {
    log.log(LOG_PREFIX, `Retrieving Firebase App...`);
    _fbApp = Firebase.initializeApp(Keys.fbConfig);
    _fbAuth = await _fbApp.auth().signInWithEmailAndPassword(email, password);
    log.verbose(LOG_PREFIX, 'Firebase auth success.');
  } catch (ex) {
    log.exception(LOG_PREFIX, 'Firebase auth failed.', ex);
    _fbApp = null;
    _fbAuth = null;
  }
  return _fbApp;
}

/**
 * Get the current Firebase Auth object
 *
 * @return {?auth}
 */
function _getAuth() {
  return _fbAuth;
}

/**
 * Returns the Firebase ServerValue.TIMESTAMP
 *
 * @return {Object}
 */
function _getServerTimeStamp() {
  return Firebase.database.ServerValue.TIMESTAMP;
}

/**
 * Gets the default Firebase Database.
 *
 * @return {?Promise<database>}
 */
async function _getDB() {
  const fbApp = await _getApp();
  if (!fbApp) {
    log.error(LOG_PREFIX, 'Unabled to get DB - no app.');
    return null;
  }
  try {
    log.log(LOG_PREFIX, `Retrieving Firebase database...`);
    _fbDB = _fbApp.database();
  } catch (ex) {
    log.exception(LOG_PREFIX, 'Unable to obtain database.', ex);
    _fbDB = null;
  }
  return _fbDB;
}

/**
 * Get a reference to a specific Firebase DB reference.
 *
 * @param {String} path Path to datastore
 * @return {?Promise<database.ref>}
 */
async function _getRef(path) {
  const fbDB = await _getDB();
  if (!fbDB) {
    log.error(LOG_PREFIX, 'Unable to get REF - no DB');
    return null;
  }
  try {
    log.verbose(LOG_PREFIX, `Retrieving Firebase database reference...`, path);
    return fbDB.ref(path);
  } catch (ex) {
    log.exception(LOG_PREFIX, 'Unable to obtain reference.', ex);
    return null;
  }
}

exports.getApp = _getApp;
exports.getAuth = _getAuth;
exports.getDB = _getDB;
exports.getRef = _getRef;
exports.getServerTimeStamp = _getServerTimeStamp;
