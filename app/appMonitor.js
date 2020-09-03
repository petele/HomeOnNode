'use strict';

const fs = require('fs');
const os = require('os');
const log = require('./SystemLog2');
const FBHelper = require('./FBHelper');
const DeviceMonitor = require('./DeviceMonitor');

const LOG_PREFIX = 'MONITOR';
const HOST_NAME = _getHostname();

let _deviceMonitor;

const logOpts = {
  consoleLogLevel: 0,
  firebaseLogLevel: 45,
  fileLogLevel: 45,
  fileFilename: './logs/monitor.log',
};

log.setAppName(LOG_PREFIX);
log.setOptions(logOpts);
log.startWSS(8882);
log.appStart();

/**
 * Gets the simple hostname
 *
 * @return {String} hostname
 */
function _getHostname() {
  const hostname = os.hostname();
  if (!hostname.includes('.')) {
    return hostname;
  }
  return hostname.substring(0, hostname.indexOf('.'));
}

/**
 * Init
 */
async function go() {
  const fbRef = await FBHelper.getRef(`logs/monitor/${HOST_NAME}`);
  if (!fbRef) {
    log.fatal(LOG_PREFIX, 'Unable to obtain Firebase reference.');
    return;
  }

  log.setFirebaseRef(fbRef);

  _deviceMonitor = new DeviceMonitor(HOST_NAME);
  _deviceMonitor.on('restart_request', () => {
    _deviceMonitor.restart('FB', 'restart_request', false);
  });
  _deviceMonitor.on('shutdown_request', () => {
    _deviceMonitor.shutdown('FB', 'shutdown_request', false);
  });
  _deviceMonitor.on('connection_timedout', () => {
    _deviceMonitor.restart('FB', 'connection_timedout', false);
  });

  setInterval(() => {
    log.cleanLogs(7).catch((err) => {
      log.exception(LOG_PREFIX, 'Unable to clean firebase logs.', err);
    });
    log.cleanFile().catch((err) => {
      log.exception(LOG_PREFIX, 'Unable to clean log file.', err);
    });
    const foreverLogFile = './logs/forever.log';
    if (fs.existsSync(foreverLogFile)) {
      log.cleanFile(foreverLogFile).catch((err) => {
        log.exception(LOG_PREFIX, 'Unable to clean forever file.', err);
      });
    }
  }, 60 * 60 * 24 * 1000);
}

process.on('SIGINT', function() {
  _deviceMonitor.shutdown('SIGINT', 'shutdown_request', 0);
});

go();
