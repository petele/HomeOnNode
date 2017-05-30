'use strict';

const Keys = require('./Keys').keys;
const Firebase = require('firebase');
const log = require('./SystemLog2');

const LOG_PREFIX = 'CLEAN_LOGS';

const fb = new Firebase(`https://${Keys.firebase.appId}.firebaseio.com/`);
fb.authWithCustomToken(Keys.firebase.key, function(error, authToken) {
  if (error) {
    log.exception(LOG_PREFIX, 'Firebase auth failed.', error);
  } else {
    log.log(LOG_PREFIX, 'Firebase auth success.');
    log.setFirebaseRef(fb);
    let promises = [];
    promises.push(log.cleanLogs('logs/doors', 30));
    promises.push(log.cleanLogs('logs/presence'));
    promises.push(log.cleanLogs('logs/systemState', 14));
    promises.push(log.cleanLogs('logs/pushBullet', 5));
    promises.push(log.cleanLogs('logs/logs', 7));
    Promise.all(promises)
    .then(() => {
      return log.cleanFile();
    })
    .catch((ex) => {
      log.exception(LOG_PREFIX, 'Exception occured', ex);
    })
    .then(() => {
      process.exit(0);
    });
  }
});
