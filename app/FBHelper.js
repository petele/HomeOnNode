'use strict';

const Firebase = require('firebase/app');
require('firebase/auth');
require('firebase/database');
const log = require('./SystemLog2');
const Keys = require('./Keys').keys;

const LOG_PREFIX = 'LOG_VIEWER';

let _fbApp;
let _fbDB;

/**
 * Gets the default Firebase Database.
 *
 * @return {?Promise<database>}
 */
async function _getDB() {
  if (_fbApp && _fbDB) {
    return _fbDB;
  }
  _fbApp = Firebase.initializeApp(Keys.fbConfig);
  const email = Keys.fbUser.email;
  const password = Keys.fbUser.password;
  try {
    await _fbApp.auth().signInWithEmailAndPassword(email, password);
    log.log(LOG_PREFIX, 'Firebase auth success.');
    _fbDB = _fbApp.database();
    return _fbDB;
  } catch (ex) {
    log.exception(LOG_PREFIX, 'Firebase auth failed.', ex);
    return null;
  }
}

exports.getDB = _getDB;
