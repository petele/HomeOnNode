'use strict';

var Keys = require('./Keys').keys;
var Firebase = require('firebase');
var log = require('./SystemLog');

log.setFileLogging(false);

var fbURL = 'https://' + Keys.firebase.appId + '.firebaseio.com/';
var fb = new Firebase(fbURL);
fb.authWithCustomToken(Keys.firebase.key, function(error, authToken) {
  if (error) {
    log.exception('[FIREBASE] Auth failed.', error);
  } else {
    log.setFirebase(fb);
    log.cleanLogs('logs/doors', 30);
    log.cleanLogs('logs/logs', 4);
    log.cleanLogs('logs/presence');
    log.cleanLogs('logs/systemState', 30);
    process.exit(0);
  }
});
