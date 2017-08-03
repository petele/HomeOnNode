'use strict';

const EventEmitter = require('events').EventEmitter;
const log = require('./SystemLog2');
const util = require('util');
const WebSocket = require('ws');

const LOG_PREFIX = 'WS_CLIENT';

/**
 * WebSocket Client
 * @constructor
 *
 * @fires WSClient#message
 * @param {String} host Host and port to connect to.
 * @param {Boolean} retry Automatically try to reconnect.
*/
function WSClient(host, retry) {
  const PING_INTERVAL = 30 * 1000;
  const _self = this;
  this.connected = false;
  let _ws;
  let _interval;

  /**
   * Init the WebSocket Server
  */
  function _init() {
    log.init(LOG_PREFIX, 'Starting...');
    if (!host) {
      log.error(LOG_PREFIX, 'No hostname provided.');
      return;
    }
    _connect();
  }

  /**
   * Connect to the WebSocket Server
   */
  function _connect() {
    log.log(LOG_PREFIX, `Connecting to ws://${host}`);
    _ws = new WebSocket(`ws://${host}`);
    _ws.on('open', () => {
      _self.connected = true;
      log.debug(LOG_PREFIX, 'WebSocket opened');
      _interval = setInterval(() => {
        _ws.ping('', false, true);
      }, PING_INTERVAL);
    });
    _ws.on('close', () => {
      _self.connected = false;
      if (_interval) {
        clearInterval(_interval);
        _interval = null;
      }
      if (retry === true) {
        log.debug(LOG_PREFIX, 'Will retry in 2 seconds...');
        setTimeout(() => {
          _connect();
        }, 2000);
      } else {
        log.log(LOG_PREFIX, 'WebSocket closed.');
      }
    });
    _ws.on('message', _wsMessage);
    _ws.on('error', _wsError);
  }

  /**
   * Handles an incoming message
   *
   * @param {String} msg Incoming message, expect JSON-able string.
   */
  function _wsMessage(msg) {
    try {
      msg = JSON.parse(msg);
    } catch (ex) {
      log.error(LOG_PREFIX, `Unable to parse message ${msg}`, ex);
      return;
    }
    _self.emit('message', msg);
  }

  /**
   * Handles errors
   *
   * @param {Error} err The incoming error.
   */
  function _wsError(err) {
    log.error(LOG_PREFIX, 'Unknown error', err);
  }

  /**
   * Sends a message
   *
   * @param {String} msg Message to send to the server.
   * @return {Promise} A promise with the result of the request.
   */
  this.send = function(msg) {
    return new Promise(function(resolve, reject) {
      if (!_ws) {
        log.error(LOG_PREFIX, 'No WebSocket connection available.');
        reject(new Error('no_connection'));
        return;
      }
      if (_ws.readyState !== WebSocket.OPEN) {
        log.error(LOG_PREFIX, 'WebSocket connection not open.', _ws.readyState);
        reject(new Error('not_open'));
        return;
      }
      _ws.send(msg, (err) => {
        if (err) {
          log.error(LOG_PREFIX, 'Error sending message.', err);
          reject(err);
          return;
        }
        log.verbose(LOG_PREFIX, 'Message sent.', msg);
        resolve();
      });
    });
  };

  _init();
}
util.inherits(WSClient, EventEmitter);

module.exports = WSClient;
