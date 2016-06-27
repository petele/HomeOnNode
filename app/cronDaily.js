/* globals log */

'use strict';

var cronJob = function() {
  log.cleanLogs('logs/doors', 30);
  log.cleanLogs('logs/logs', 4);
  log.cleanLogs('logs/presence');
  log.cleanLogs('logs/systemState', 30);
  log.cleanFile();
};

cronJob();
