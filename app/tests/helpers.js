'use strict';

// Mocha Docs -- https://mochajs.org/
// Chai Assertion Libs -- http://chaijs.com/api/assert/

const Keys = require('../Keys').keys;
const log = require('../SystemLog2');
const Firebase = require('../node_modules/firebase');

const LOG_PREFIX = 'HELPER';

function _setBasicLogging() {
  let opts = {
    fileLogLevel: -1,
    fileFilename: './tests.log',
    consoleLogLevel: -1,
    firebaseLogLevel: -1,
    firebasePath: 'logs/tests',
  };
  log.setOptions(opts);
}

function _sleep(ms) {
  return new Promise(function(resolve, reject) {
    log.log(LOG_PREFIX, `Sleep started for ${ms} ms...`);
    setTimeout(() => {
      log.log(LOG_PREFIX, `Awoken from slumber...`);
      resolve(true);
    }, Math.floor(ms));
  });
}

function _getFBRef() {
  return new Promise(function(resolve, reject) {
    const fb = new Firebase(`https://${Keys.firebase.appId}.firebaseio.com/`);
    fb.authWithCustomToken(Keys.firebase.key, function(error, authToken) {
      if (error) {
        reject(error);
        return;
      }
      resolve(fb);
    });
  });
}

exports.getFBRef = _getFBRef;
exports.setBasicLogging = _setBasicLogging;
exports.sleep = _sleep;
