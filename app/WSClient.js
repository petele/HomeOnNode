'use strict';

const util = require('util');
const WebSocket = require('ws');
const log = require('./SystemLog2');
const EventEmitter = require('events').EventEmitter;

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
  let _retry = retry;
  let _interval;

  /**
   * Init the WebSocket Client and connect to the server
  */
  function _init() {
    if (!host) {
      log.error(LOG_PREFIX, 'No hostname provided.');
      return;
    }
    let wsURL = `ws://${host}`;
    if (host.indexOf('ws://') === 0 || host.indexOf('wss://') === 0) {
      wsURL = host;
    }
    log.init(LOG_PREFIX, `Connecting to ${wsURL}`);
    _ws = new WebSocket(wsURL);
    _ws.on('open', _wsOpen);
    _ws.on('close', _wsClose);
    _ws.on('message', _wsMessage);
    _ws.on('error', _wsError);
    _ws.on('ping', _wsPing);
    _ws.on('pong', _wsPong);
  }

  /**
   * Handles the ping event
   */
  function _wsPing() {
    log.verbose(LOG_PREFIX, 'Ping.');
    _self.emit('ping');
  }

  /**
   * Handles the ping event
   */
  function _wsPong() {
    log.verbose(LOG_PREFIX, 'Pong.');
    _self.emit('pong');
  }

  /**
   * Handles the close event
   */
  function _wsClose() {
    _self.connected = false;
    _self.emit('disconnect');
    _clearPingPong();
    if (_retry === true) {
      log.debug(LOG_PREFIX, 'Will retry in 2 seconds...');
      setTimeout(() => {
        _init();
      }, 2000);
    } else {
      log.log(LOG_PREFIX, 'WebSocket closed.');
    }
  }

  /**
   * Handles the open event
   */
  function _wsOpen() {
    _self.connected = true;
    _self.emit('connect');
    log.debug(LOG_PREFIX, 'WebSocket opened');
    _interval = setInterval(() => {
      _ws.ping('', false, true);
    }, PING_INTERVAL);
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
    log.error(LOG_PREFIX, 'Client error.', err);
  }

  /**
   * Clears the ping/pong interval
   */
  function _clearPingPong() {
    if (_interval) {
      clearInterval(_interval);
      _interval = null;
    }
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
        log.verbose(LOG_PREFIX, 'Message sent.', JSON.parse(msg));
        resolve();
      });
    });
  };

  /**
   * Shutdown the WebSocket client connection
   */
  this.shutdown = function() {
    log.log(LOG_PREFIX, 'Shutting down...');
    _retry = false;
    _clearPingPong();
    if (_ws) {
      _ws.removeAllListeners('open');
      _ws.removeAllListeners('close');
      _ws.removeAllListeners('message');
      _ws.removeAllListeners('ping');
      _ws.removeAllListeners('pong');
      _ws.close();
      _ws.removeAllListeners('error');
    }
    _self.emit('shutdown');
  };

  _init();
}
util.inherits(WSClient, EventEmitter);

module.exports = WSClient;
