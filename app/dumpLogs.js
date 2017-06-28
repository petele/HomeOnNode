#!/usr/bin/env node

'use strict';

const Keys = require('./Keys').keys;
const Firebase = require('firebase');
const log = require('./SystemLog2');
const commander = require('commander');

commander
  .version('0.2.0')
  .option('-n, --number <value>', 'Number of log items to show', 100)
  .option('-p, --path <value>', 'Log path to use', 'server')
  .option('-q, --quit', 'Quit after completion')
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
      let msg = log.stringifyLog(snapshot.val());
      // eslint-disable-next-line no-console
      console.log(msg);
      if ((++logItemsShown >= commander.number) && (commander.quit === true)) {
        process.exit(0);
      }
    }
  );
}

const fb = new Firebase(`https://${Keys.firebase.appId}.firebaseio.com/`);
fb.authWithCustomToken(Keys.firebase.key, function(error, authToken) {
  if (error) {
    log.exception('DUMPLOG', 'Firebase auth failed.', error);
  } else {
    log.log('DUMPLOG', 'Firebase auth success.');
    log.log('DUMPLOG', `logs/${commander.path}`);
    printLogs(`logs/${commander.path}`);
  }
});
