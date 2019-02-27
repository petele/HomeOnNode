#!/usr/bin/env node

'use strict';

const log = require('./SystemLog2');
const Keys = require('./Keys').keys;
const Firebase = require('firebase');
const commander = require('commander');

const LOG_PREFIX = 'LOG_VIEWER';
let _path = 'logs/server';

commander
    .version('0.2.0')
    .option('-n, --number <value>', 'Number of log items to show (100)', 100)
    .option('-q, --quit', 'Quit after completion')
    .option('--clean', 'Clean logs older than 7 days')
    .option('--days <value>', 'Specifies the number of days to clean.', 7)
    .arguments('<path>')
    .action((path) => {
      _path = `logs/${path}`;
    })
    .parse(process.argv);

commander.number = parseInt(commander.number, 10);

/**
 * Reboot the device.
 *
 * @param {String} path Firebase path of the logs to print.
*/
function printLogs(path) {
  let logItemsShown = 0;
  fb.child(path).orderByChild('date').limitToLast(commander.number)
      .on('child_added', function(snapshot) {
        const msg = log.stringifyLog(snapshot.val());
        // eslint-disable-next-line no-console
        console.log(msg);
        logItemsShown++;
        if ((logItemsShown >= commander.number) && (commander.quit === true)) {
          process.exit(0);
        }
      });
}

/**
 * Called when clean-up is completed.
 *
 * @param {Object} [result] The result of the cleanup.
 */
function cleanComplete(result) {
  log.log(LOG_PREFIX, 'Complete.', result);
  process.exit(0);
}

/**
 * Clean the logs at the given path.
 *
 * @param {String} path Firebase path of the logs to print.
 * @param {Number} days Remove any log item older than x days.
 */
function cleanLogs(path, days) {
  if (days === 'ALL') {
    log.log(LOG_PREFIX, `Cleaning all logs from ${path}.`);
    fb.child(path).set(null).then(cleanComplete);
    return;
  }
  days = parseInt(days, 10);
  if (isNaN(days) === true) {
    log.error(LOG_PREFIX, 'Days must be a number');
    process.exit(1);
  }
  log.log(LOG_PREFIX, `Cleaning logs from ${path} older than ${days} days.`);
  log.setFirebaseRef(fb);
  log.cleanLogs(path, days).then(cleanComplete);
}


const fb = new Firebase(`https://${Keys.firebase.appId}.firebaseio.com/`);
fb.authWithCustomToken(Keys.firebase.key, function(error, authToken) {
  if (error) {
    log.exception(LOG_PREFIX, 'Firebase auth failed.', error);
    process.exit(1);
  } else {
    log.log(LOG_PREFIX, 'Firebase auth success.');
    log.log(LOG_PREFIX, `Log path: ${_path}`);
    if (commander.clean === true) {
      cleanLogs(_path, commander.days);
      return;
    }
    printLogs(_path);
  }
});
