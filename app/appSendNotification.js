'use strict';

/* node14_ready */

const os = require('os');
const log = require('./SystemLog2');
const GCMPush = require('./GCMPush');

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
async function _sendMessage() {
  try {
    await gcmPush.sendMessage(DEFAULT_MESSAGE);
    log.log(LOG_PREFIX, LOG_PREFIX, 'Sent messages...');
    process.exit(0);
  } catch (ex) {
    log.exception(LOG_PREFIX, 'Unable to send messsages.', ex);
    process.exit(1);
  }
}

const gcmPush = new GCMPush();
gcmPush.on('ready', _sendMessage);

