'use strict';

var GCMPush = require('../app/GCMPush');
var Keys = require('../app/Keys').keys;
var Firebase = require('../app/node_modules/firebase');
var log = require('../app/SystemLog');

function init() {
  log.setVerbose(false);
  var fbURL = 'https://' + Keys.firebase.appId + '.firebaseio.com';
  var fb = new Firebase(fbURL);
  fb.authWithCustomToken(Keys.firebase.key, function(error) {
    if (error) {
      log.exception('[FB] Authentication error', error);
      process.exit(1);
    } else {
      var gcmPush = new GCMPush(fb);
      gcmPush.on('ready', function() {
        gcmPush.send(function() {
          process.exit(0);
        });
      });
    }
  });
}

init();
