'use strict';

const fs = require('fs');
const log = require('./SystemLog2');
const Keys = require('./Keys').keys.firebase;
const Firebase = require('firebase');

const LOG_PREFIX = 'GET_CONFIG';

const fb = new Firebase(`https://${Keys.appId}.firebaseio.com/`);

/**
 * Gets the config data from Firebase.
 *
 * @param {String} path The path to the config file.
*/
function _getConfigFromFB(path) {
  fb.authWithCustomToken(Keys.key, function(error, authToken) {
    if (error) {
      log.exception(LOG_PREFIX, 'Auth Error', error);
      process.exit(1);
    }
    log.log(LOG_PREFIX, 'Requesting config file...');
    path = 'config/' + path;
    fb.child(path).once('value', function(snapshot) {
      log.log(LOG_PREFIX, 'Config file received.');
      const config = snapshot.val();
      if (config) {
        fs.writeFileSync('config.json', JSON.stringify(config, null, 2));
        log.log(LOG_PREFIX, 'Config file saved.');
        process.exit(0);
      } else {
        log.error(LOG_PREFIX, 'No config file file found at that location.');
        process.exit(1);
      }
    }, function(err) {
      log.exception(LOG_PREFIX, 'Error retreiving config file.', err);
      process.exit(1);
    });
  });

  setTimeout(function() {
    log.error(LOG_PREFIX, 'Timeout exceeded.');
    process.exit(1);
  }, 30000);
}

log.appStart('getConfig', false);
let appId = process.argv[2];
if (!appId) {
  log.log('No app id provided, using HomeOnNode');
  appId = 'HomeOnNode';
}
_getConfigFromFB(appId);
