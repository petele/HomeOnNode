'use strict';

var fs = require('fs');
var log = require('./SystemLog2');
var Keys = require('./Keys').keys.firebase;
var Firebase = require('firebase');

var LOG_PREFIX = 'GET_CONFIG';

var fbURL = 'https://' + Keys.appId + '.firebaseio.com/';
var fb = new Firebase(fbURL);

function init(path) {
  fb.authWithCustomToken(Keys.key, function(error, authToken) {
    if (error) {
      log.exception(LOG_PREFIX, 'Auth Error', error);
      process.exit(1);
    }
    log.log(LOG_PREFIX, 'Requesting config file...');
    path = 'config/' + path;
    fb.child(path).once('value', function(snapshot) {
      log.log(LOG_PREFIX, 'Config file received.');
      var config = snapshot.val();
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
var appId = process.argv[2];
if (!appId) {
  log.log('No app id provided, using HomeOnNode');
  appId = 'HomeOnNode';
}
init(appId);
