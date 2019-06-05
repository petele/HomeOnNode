'use strict';

const os = require('os');
const log = require('./SystemLog2');
const Keys = require('./Keys').keys;
const GCMPush = require('./GCMPush');
const Firebase = require('firebase');

const LOG_PREFIX = 'SEND_ON_ERROR';

const logOpts = {
  consoleLogLevel: 20,
  fileLogLevel: 90,
  fileFilename: './logs/system.log',
};
log.setOptions(logOpts);

let hostname = os.hostname().toUpperCase();
if (hostname.indexOf('.') >= 0) {
  hostname = hostname.substring(0, hostname.indexOf('.'));
}

const DEFAULT_MESSAGE = {
  title: `${hostname} - Error`,
  body: 'Something unexpected happened at',
  tag: `HoN-error`,
  uniqueTag: true,
  appendTime: true,
  urgent: true,
  requireInteraction: true,
  renotify: true,
};

/**
 * Send default message to all users
 */
function _sendMessage() {
  const fb = new Firebase(`https://${Keys.firebase.appId}.firebaseio.com`);
  fb.authWithCustomToken(Keys.firebase.key, function(error) {
    if (error) {
      log.exception(LOG_PREFIX, 'Authentication error', error);
      process.exit(1);
    } else {
      const gcmPush = new GCMPush(fb);
      gcmPush.on('ready', function() {
        gcmPush.sendMessage(DEFAULT_MESSAGE)
            .catch((ex) => {
              log.exception(LOG_PREFIX, 'Unable to send message', ex);
            })
            .then(() => {
              log.custom('STOP', LOG_PREFIX, 'Sent messages...');
              process.exit(0);
            });
      });
    }
  });
}

_sendMessage();
