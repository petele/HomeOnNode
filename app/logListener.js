#!/usr/bin/env node

'use strict';

/* node14_ready */

const log = require('./SystemLog2');
const WSClient = require('./WSClient');
const commander = require('commander');

const DEFAULT_HOST = `rpi-server:8881`;

let _host;

commander
    .version('0.2.0')
    .option('-l, --level <value>', 'Max log level to show', 100)
    .option('-r, --retry', 'Retry the connection', false)
    .arguments('[host:port]')
    .action((host) => {
      _host = host || DEFAULT_HOST;
    })
    .parse(process.argv);
commander.level = parseInt(commander.level);

// const logOpts = {consoleLogLevel: commander.level};
// log.setOptions(logOpts);

/**
 * Prints a log message.
 *
 * @param {Object} logObj The incoming log object.
*/
function printLog(logObj) {
  if (logObj.levelValue <= commander.level) {
    // eslint-disable-next-line no-console
    console.log(log.stringifyLog(logObj));
  }
}

const _ws = new WSClient(_host, commander.retry, 'server');
_ws.on('message', printLog);
