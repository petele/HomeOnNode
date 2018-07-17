/* globals log */

'use strict';

const cronJob = function() {
  const promises = [];
  promises.push(log.cleanLogs('logs/doors', 30));
  promises.push(log.cleanLogs('logs/generic', 7));
  promises.push(log.cleanLogs('logs/logs', 7));
  promises.push(log.cleanLogs('logs/messages', 7));
  promises.push(log.cleanLogs('logs/presence', 120));
  promises.push(log.cleanLogs('logs/pushBullet', 1));
  promises.push(log.cleanLogs('logs/systemState', 30));
  promises.push(log.cleanLogs('logs/cron', 90));

  Promise.all(promises)
  .then(() => {
    return log.cleanFile();
  })
  .catch((ex) => {
    log.exception('CRON_DAILY', 'Error occured while cleaning logs.', ex);
  });
};

cronJob();
