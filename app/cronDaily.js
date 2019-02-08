/* globals log, fs, _fb */

'use strict';

const path = require('path');
const moment = require('moment');

const LOG_PREFIX = 'CRON_DAILY';
const CONFIG_BACKUP_PATH = `./config-backup`;

const __cleanLogs = function() {
  log.debug(LOG_PREFIX, 'Starting cleanLogs...');
  const promises = [];
  promises.push(log.cleanLogs('logs/cron', 90));
  promises.push(log.cleanLogs('logs/doors', 30));
  promises.push(log.cleanLogs('logs/presence', 120));
  promises.push(log.cleanLogs('logs/systemState', 30));
  promises.push(log.cleanLogs('logs/generic', 7));
  promises.push(log.cleanLogs('logs/logs', 7));
  promises.push(log.cleanLogs('logs/messages', 7));
  promises.push(log.cleanLogs('logs/pushBullet', 1));

  return Promise.all(promises)
    .then(() => {
      return log.cleanFile();
    })
    .catch((ex) => {
      log.exception(LOG_PREFIX, 'Error occured while cleaning logs.', ex);
    });
};

const __backupConfig = function() {
  log.debug(LOG_PREFIX, 'Backing up config...');
  return new Promise((resolve, reject) => {
    _fb.child(`config`).on('once', (snapshot) => {
      const filename = `config-${moment().format('YYYY-MM-DD')}.json`;
      if (!false.existsSync(CONFIG_BACKUP_PATH)) {
        fs.mkdirSync(CONFIG_BACKUP_PATH);
      }
      const file = path.join(CONFIG_BACKUP_PATH, filename);
      const config = JSON.stringify(snapshot.val(), null, 2);
      fs.writeFile(file, config, (err) => {
        if (err) {
          log.exception(LOG_PREFIX, `Error while backing up config.`, err);
          reject(err);
          return;
        }
        resolve(true);
      });
    });
  }).catch((err) => {
    // NoOp - error has already been logged, we don't care.
    return false;
  });
};

const cronJob = function() {
  return __cleanLogs()
    .then(() => {
      return __backupConfig();
    })
    .then(() => {
      log.log(LOG_PREFIX, 'Completed.');
    })
    .catch((err) => {
      log.exception(LOG_PREFIX, 'Cron job failed.', err);
    });
};

cronJob();
