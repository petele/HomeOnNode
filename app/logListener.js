#!/usr/bin/env node

'use strict';

const WebSocket = require('ws');
const log = require('./SystemLog2');
const commander = require('commander');

let _interval;
let _host = 'rpi-server.local:8881';

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
 * @param {String} message The incoming message.
*/
function printLog(message) {
  const logObj = JSON.parse(message);
  if (logObj.levelValue <= commander.level) {
    // eslint-disable-next-line no-console
    console.log(log.stringifyLog(logObj));
  }
}

/**
 * Connects to the server.
 *
 * @param {String} message The incoming message.
*/
function connect() {
  log.log('WSS', `Connecting to ws://${_host}`);
  _ws = new WebSocket(`ws://${_host}`);
  _ws.on('open', () => {
    log.log('WSS', 'WebSocket opened');
    _interval = setInterval(() => {
      _ws.ping('', false, true);
    }, 30 * 1000);
  });
  _ws.on('close', () => {
    if (_interval) {
      clearInterval(_interval);
      _interval = null;
    }
    if (commander.retry === true) {
      log.log('WSS', 'Will retry in 2 seconds...');
      setTimeout(() => {
        connect();
      }, 2000);
    } else {
      log.log('WSS', 'WebSocket closed.');
    }
  });
  _ws.on('message', printLog);
  _ws.on('error', (err) => {
    log.error('WSS', 'Socket error occured', err);
  });
}

connect();

