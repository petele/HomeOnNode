/* globals log */

'use strict';

const cronJob = function() {
  let promises = [];
  promises.push(log.cleanLogs('logs/bedside', 7));
  promises.push(log.cleanLogs('logs/doorbell', 7));
  promises.push(log.cleanLogs('logs/doors', 30));
  promises.push(log.cleanLogs('logs/generic', 7));
  promises.push(log.cleanLogs('logs/logs', 7));
  promises.push(log.cleanLogs('logs/presence'));
  promises.push(log.cleanLogs('logs/pushBullet', 1));
  promises.push(log.cleanLogs('logs/server', 7));
  promises.push(log.cleanLogs('logs/systemState', 30));
  promises.push(log.cleanLogs('logs/monitor', 2));
  Promise.all(promises)
  .then(() => {
    return log.cleanFile();
  })
  .catch((ex) => {
    log.exception('CRON_DAILY', 'Error occured while cleaning logs.', ex);
  });
};

cronJob();
