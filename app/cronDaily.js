/* globals log, fs, _fb */

'use strict';

const path = require('path');
const moment = require('moment');

const LOG_PREFIX = 'CRON_DAILY';
const CONFIG_BACKUP_PATH = `./config-backup`;

const _cleanLogs = function() {
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
  promises.push(
      log.cleanLogs('logs/hvacState/dQ2cONq2P3MTSPzuctw3jrX_gKS0QBk1', 120));
  promises.push(
      log.cleanLogs('logs/hvacState/dQ2cONq2P3NPOgLG6WFYC7X_gKS0QBk1', 120));

  return Promise.all(promises)
      .catch((err) => {
        log.warn(LOG_PREFIX, 'Unable to clean Firebase logs', err);
      })
      .then(() => {
        return log.cleanFile()
            .catch(() => {
              // Ignore, we've already logged the error elsewhere.
            });
      })
      .catch((ex) => {
        log.exception(LOG_PREFIX, 'Unknown error while cleaning logs.', ex);
      });
};

const _backupConfig = function() {
  log.debug(LOG_PREFIX, 'Backing up config...');
  return new Promise((resolve, reject) => {
    _fb.child(`config`).once('value', (snapshot) => {
      const filename = `config-${moment().format('YYYY-MM-DD')}.json`;
      if (!fs.existsSync(CONFIG_BACKUP_PATH)) {
        fs.mkdirSync(CONFIG_BACKUP_PATH);
      }
      const file = path.join(CONFIG_BACKUP_PATH, filename);
      const config = JSON.stringify(snapshot.val(), null, 2);
      fs.writeFile(file, config, (err) => {
        if (err) {
          reject(err);
          return;
        }
        log.debug(LOG_PREFIX, `Config backed up to: ${file}`);
        resolve(true);
      });
    });
  }).catch((err) => {
    log.exception(LOG_PREFIX, `Error while backing up config.`, err);
    return false;
  });
};

const cronJob = function() {
  return _cleanLogs()
      .then(() => {
        return _backupConfig();
      }).then(() => {
        log.log(LOG_PREFIX, 'Completed.');
      }).catch((err) => {
        log.exception(LOG_PREFIX, 'Cron job failed.', err);
      });
};

cronJob();
