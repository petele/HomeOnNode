'use strict';

const GCMPush = require('./GCMPush');
const Keys = require('./Keys').keys;
const Firebase = require('firebase');
const log = require('./SystemLog2');

const DEFAULT_MESSAGE = {
  title: 'HomeOnNode - Eep!',
  body: 'Something unexpected happened at',
  tag: 'HoN-unexpected',
  appendTime: true,
};

/**
 * Send default message to all users
*/
function _sendMessage() {
  const fb = new Firebase(`https://${Keys.firebase.appId}.firebaseio.com`);
  fb.authWithCustomToken(Keys.firebase.key, function(error) {
    if (error) {
      log.exception('FB', 'Authentication error', error);
      process.exit(1);
    } else {
      const gcmPush = new GCMPush(fb);
      gcmPush.on('ready', function() {
        gcmPush.sendMessage(DEFAULT_MESSAGE);
      });
    }
  });
}

_sendMessage();
setTimeout(function() {
  process.exit(0);
}, 3000);
