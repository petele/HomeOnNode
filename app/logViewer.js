#!/usr/bin/env node

'use strict';

/* node14_ready */

const log = require('./SystemLog2');
const commander = require('commander');
const FBHelper = require('./FBHelper');

const LOG_PREFIX = 'LOG_VIEWER';
const DEFAULT_PATH = 'apps/server';

let _path;

commander
    .version('0.2.0')
    .option('-c, --clean <value>', 'Clean the logs to the last X days')
    .option('-n, --number <value>', 'Number of log items to show (100)', 100)
    .option('-q, --quit', 'Quit after completion')
    .arguments('[path]')
    .action((path) => {
      _path = `logs/${path || DEFAULT_PATH}`;
    })
    .parse(process.argv);
commander.number = parseInt(commander.number, 10);

/**
 * Print log items to screen.
 *
 * @param {database} fbRef Firebase db reference
*/
function printLogs(fbRef) {
  let logItemsShown = 0;
  fbRef.orderByChild('date')
      .limitToLast(commander.number)
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
 * Clean log items from the database.
 */
async function clean() {
  const days = parseInt(commander.clean);
  log.log(LOG_PREFIX, `Clean - path: ${_path} | ${days}`);
  const result = await log.cleanLogs(_path, days);
  log.log(LOG_PREFIX, 'Clean-up complete.', result);
  process.exit(0);
}

/**
 * Start the app
 */
async function view() {
  log.log(LOG_PREFIX, `View - path: ${_path}`);
  let fbLogRef;
  try {
    const fbRootRef = await FBHelper.getRootRef(30 * 1000);
    fbLogRef = await fbRootRef.child(_path);
  } catch (ex) {
    log.fatal(LOG_PREFIX, 'Unable to connect to Firebase.', ex);
    process.exit(1);
  }
  printLogs(fbLogRef);
}

if (commander.clean) {
  clean();
} else {
  view();
}
