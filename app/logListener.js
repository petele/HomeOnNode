#!/usr/bin/env node

'use strict';

// const WebSocket = require('ws');
const WSClient = require('./WSClient');
const log = require('./SystemLog2');
const commander = require('commander');

let _host = 'rpi-server:8881';

let _ws;

commander
  .version('0.2.0')
  .option('-l, --level <value>', 'Max log level to show', 100)
  .option('-r, --retry', 'Retry the connection', false)
  .arguments('<host:port>')
  .action((host) => {
    _host = host;
  })
  .parse(process.argv);

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

_ws = new WSClient(_host, commander.retry);
_ws.on('message', printLog);
