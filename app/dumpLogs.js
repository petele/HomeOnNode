'use strict';

var Keys = require('./Keys').keys;
var Firebase = require('firebase');
var log = require('./SystemLog');

function printLogs(path) {
  fb.child(path).orderByChild('date').limitToLast(100).on('value',
    function(snapshot) {
      snapshot.forEach(function(item) {
        var msg = item.val();
        log.printLogObj(msg);
      });
    }
  );
}

var fbURL = 'https://' + Keys.firebase.appId + '.firebaseio.com/';
var fb = new Firebase(fbURL);
fb.authWithCustomToken(Keys.firebase.key, function(error, authToken) {
  if (error) {
    log.exception('[FIREBASE] Auth failed.', error);
  } else {
    log.log('[FIREBASE] Auth success.');
    printLogs('logs/logs');
  }
});
