'use strict';

const os = require('os');
const GCMPush = require('./GCMPush');
const Keys = require('./Keys').keys;
const Firebase = require('firebase');
const log = require('./SystemLog2');

let hostname = os.hostname().toUpperCase();
if (hostname.indexOf('.') >= 0) {
  hostname = hostname.substring(0, hostname.indexOf('.'));
}

const DEFAULT_MESSAGE = {
  title: `${hostname} - Error`,
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
        gcmPush.sendMessage(DEFAULT_MESSAGE)
        .catch((ex) => {
          log.exception('SEND_MSG', 'Unable to send message', ex);
        })
        .then(() => {
          process.exit(0);
        });
      });
    }
  });
}

_sendMessage();
