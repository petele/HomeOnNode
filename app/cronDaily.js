/* globals log */

'use strict';

const cronJob = function() {
  let promises = [];
  promises.push(log.cleanLogs('logs/doors', 30));
  promises.push(log.cleanLogs('logs/presence'));
  promises.push(log.cleanLogs('logs/systemState', 14));
  promises.push(log.cleanLogs('logs/pushBullet', 5));
  promises.push(log.cleanLogs('logs/logs', 7));
  Promise.all(promises)
  .then(() => {
    return log.cleanFile();
  })
  .catch((ex) => {
    log.exception('CRON_DAILY', 'Error occured while cleaning logs.', ex);
  });
};

cronJob();
