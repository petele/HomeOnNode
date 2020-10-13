'use strict';

/* node14_ready */

const fs = require('fs');
const log = require('./SystemLog2');
const honHelpers = require('./HoNHelpers');
const DeviceMonitor = require('./DeviceMonitor');

const OFFLINE_TIMEOUT = 10 * 60 * 1000;
const DISCONNECT_TIMEOUT = 15 * 60 * 1000;
const LOG_CLEAN_TIMER = 60 * 60 * 24 * 1000;

const LOG_PREFIX = 'MONITOR';
const HOST_NAME = honHelpers.getHostname();

let _deviceMonitor;

log.startWSS(8882);
log.setConsoleLogOpts(90);
log.setFileLogOpts(50, './logs/monitor.log');
log.setFirebaseLogOpts(50, `logs/monitor/${HOST_NAME}`);

/**
 * Init
 */
async function go() {
  log.appStart(LOG_PREFIX);

  _deviceMonitor = new DeviceMonitor(HOST_NAME, true);
  _deviceMonitor.on('restart_request', () => {
    _deviceMonitor.restart('FB', 'restart_request', false);
  });
  _deviceMonitor.on('shutdown_request', () => {
    _deviceMonitor.shutdown('FB', 'shutdown_request', false);
  });
  _deviceMonitor.on('offline', (offlineFor) => {
    if (offlineFor < OFFLINE_TIMEOUT) {
      return;
    }
    log.error(LOG_PREFIX, `Offline timeout exceeded, rebooting.`, offlineFor);
    _deviceMonitor.restart('MONITOR', 'offline_exceeded', false);
  });
  _deviceMonitor.on('disconnected', (offlineFor) => {
    if (offlineFor < DISCONNECT_TIMEOUT) {
      return;
    }
    log.error(LOG_PREFIX, `Disconnect time exceeded, rebooting.`, offlineFor);
    _deviceMonitor.restart('MONITOR', 'disconnect_exceeded', false);
  });

  setInterval(async () => {
    try {
      await log.cleanLogs(null, 7);
    } catch (err) {
      log.exception(LOG_PREFIX, 'Unable to clean firebase logs.', err);
    }
    try {
      await log.cleanFile();
    } catch (err) {
      log.exception(LOG_PREFIX, 'Unable to clean log file.', err);
    }
    try {
      const foreverLogFile = './logs/forever.log';
      if (fs.existsSync(foreverLogFile)) {
        await log.cleanFile(foreverLogFile);
      }
    } catch (err) {
      log.exception(LOG_PREFIX, 'Unable to clean forever file.', err);
    }
  }, LOG_CLEAN_TIMER);
}

process.on('SIGINT', function() {
  _deviceMonitor.shutdown('SIGINT', 'shutdown_request', 0);
});

go();
