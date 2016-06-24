'use strict';

var Keys = require('./Keys').keys;
var Firebase = require('firebase');
var log = require('./SystemLog2');

function printLogs(path) {
  fb.child(path).orderByChild('date').limitToLast(100).on('child_added',
    function(snapshot) {
      var msg = snapshot.val();
      log.printLog(msg);
    }
  );
}

var fbURL = 'https://' + Keys.firebase.appId + '.firebaseio.com/';
var fb = new Firebase(fbURL);
fb.authWithCustomToken(Keys.firebase.key, function(error, authToken) {
  if (error) {
    log.exception('DUMPLOG', 'Firebase auth failed.', error);
  } else {
    log.log('DUMPLOG', 'Firebase auth success.');
    printLogs('logs/logs');
  }
});
