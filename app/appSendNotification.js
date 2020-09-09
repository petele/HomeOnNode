'use strict';

/* node14_ready */

const log = require('./SystemLog2');
const GCMPush = require('./GCMPush');
const honHelpers = require('./HoNHelpers');

const LOG_PREFIX = 'SEND_ON_ERROR';

log.setConsoleLogOpts(50);
log.setFileLogOpts(90, './logs/system.log');

const hostname = honHelpers.getHostname().toUpperCase();

const DEFAULT_MESSAGE = {
  title: `${hostname} - Oops`,
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

