/* globals log */

'use strict';

var cronJob = function() {
  log.log('[CronDaily]');
  log.cleanLogs('logs/doors');
  log.cleanLogs('logs/logs', 4);
  log.cleanLogs('logs/presence');
  log.cleanLogs('logs/systemState');
};

cronJob();
