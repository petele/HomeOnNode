/* globals log */

'use strict';

const path = require('path');
const moment = require('moment');
const fsProm = require('fs/promises');
const FBHelper = require('./FBHelper');

const LOG_PREFIX = 'CRON_DAILY';
const CONFIG_BACKUP_PATH = `./config-backup`;

const _cleanLogs = async function() {
  log.debug(LOG_PREFIX, 'Starting cleanLogs...');

  await log.cleanLogs('logs/cron', 90);
  await log.cleanLogs('logs/doors', 30);
  await log.cleanLogs('logs/presence', 120);
  await log.cleanLogs('logs/systemState', 30);
  await log.cleanLogs('logs/generic', 7);
  await log.cleanLogs('logs/logs', 7);
  await log.cleanLogs('logs/messages', 7);
  await log.cleanLogs('logs/pushBullet', 1);
  await log.cleanFile();
};

const _backupConfig = async function() {
  log.debug(LOG_PREFIX, 'Backing up config...');
  let fbRootRef;
  try {
    fbRootRef = await FBHelper.getRootRef(30 * 1000);
  } catch (ex) {
    log.exception(LOG_PREFIX, '_backupConfig - unable to get FB ref.', ex);
    return;
  }
  const fbConfigRef = await fbRootRef.child('config');
  const configSnap = await fbConfigRef.once('value');
  const config = configSnap.val();
  const configStr = JSON.stringify(config, null, 2);

  const filename = `config-${moment().format('YYYY-MM-DD')}.json`;
  try {
    fsProm.mkdir(CONFIG_BACKUP_PATH, {recursive: true});
  } catch (ex) {
    log.error(LOG_PREFIX, `Unable to create '${CONFIG_BACKUP_PATH}'`, ex);
    return false;
  }
  const file = path.join(CONFIG_BACKUP_PATH, filename);

  try {
    fsProm.writeFile(file, configStr);
    log.debug(LOG_PREFIX, `Config backed up to: ${file}`);
  } catch (ex) {
    log.exception(LOG_PREFIX, 'Unable to save config', ex);
    return;
  }
};

const cronJob = async function() {
  await _cleanLogs();
  await _backupConfig();
};

cronJob();
