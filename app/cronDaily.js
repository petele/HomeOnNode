/* globals log */

'use strict';

var cronJob = function() {
  log.cleanLogs('logs/doors', 30);
  log.cleanLogs('logs/logs', 7);
  log.cleanLogs('logs/presence');
  log.cleanLogs('logs/systemState', 14);
  log.cleanLogs('logs/pushBullet', 7);
  log.cleanFile();
};

cronJob();
