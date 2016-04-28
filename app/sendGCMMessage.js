'use strict';

var GCMPush = require('./GCMPush');
var Keys = require('./Keys').keys;
var Firebase = require('firebase');
var log = require('./SystemLog');
var moment = require('moment');

var gcmMessage = {
  title: 'HomeOnNode',
  body: 'Boom! Something unexpected happened',
  tag: 'unexpected'
};

function init() {
  log.setVerbose(true);
  var fbURL = 'https://' + Keys.firebase.appId + '.firebaseio.com';
  var fb = new Firebase(fbURL);
  fb.authWithCustomToken(Keys.firebase.key, function(error) {
    if (error) {
      log.exception('[FB] Authentication error', error);
      process.exit(1);
    } else {
      var gcmPush = new GCMPush(fb);
      gcmMessage.id = 'unexpected-' + Date.now();
      gcmMessage.body += ' at ' + moment().format('h:mm a (ddd MMM Mo)');
      gcmPush.on('ready', function() {
        gcmPush.sendMessage(gcmMessage);
      });
    }
  });
}

init();
setTimeout(function() {
  process.exit(0);
}, 3000);
