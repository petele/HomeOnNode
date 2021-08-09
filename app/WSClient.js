'use strict';

/* node14_ready */

const url = require('url');
const util = require('util');
const WebSocket = require('ws');
const log = require('./SystemLog2');
const EventEmitter = require('events').EventEmitter;

/**
 * WebSocket Client
 * @constructor
 *
 * @fires WSClient#message
 * @param {String} host Host and port to connect to.
 * @param {Boolean} retry Automatically try to reconnect.
 * @param {String} serverName Name of the server we're connecting to.
*/
function WSClient(host, retry, serverName) {
  const PING_INTERVAL = 29 * 1000;
  const _self = this;
  const _logPrefix = `WS_${serverName.toUpperCase()}`;
  this.connected = false;
  let _ws;
  let _wsURL;
  let _retry = retry;
  let _interval;
  let _lastError;
  let _lastErrorAt = 0;

  /**
   * Init the WebSocket Client and connect to the server
  */
  function _init() {
    if (!host) {
      log.error(_logPrefix, 'No hostname provided.');
      return;
    }
    _wsURL = host;
    if ((host.indexOf('ws://') === -1) && (host.indexOf('wss://') === -1)) {
      _wsURL = `ws://${host}`;
    }
    log.init(_logPrefix, 'Starting...', url.parse(_wsURL));
    _connect();
  }

  /**
   * Connects to the WebSocket Server
   */
  function _connect() {
    log.debug(_logPrefix, `Connecting to ${_wsURL}`);
    _ws = new WebSocket(_wsURL);
    _ws.on('open', _wsOpen);
    _ws.on('close', _wsClose);
    _ws.on('message', _wsMessage);
    _ws.on('error', _wsError);
  }

  /**
   * Handles the close event
   */
  function _wsClose() {
    if (_self.connected) {
      log.log(_logPrefix, `WebSocket closed.`);
    }
    _self.connected = false;
    _self.emit('disconnect');
    _self.emit('connected', false);
    _clearPingPong();
    if (_retry === true) {
      log.debug(_logPrefix, `Will reconnect in 3 seconds...`);
      setTimeout(() => {
        _connect();
      }, 3000);
    }
  }

  /**
  * NoOp function for ping/pong.
  */
  function _noop() {}

  /**
   * Handles the open event
   */
  function _wsOpen() {
    _self.connected = true;
    log.verbose(_logPrefix, 'WebSocket opened.');
    _self.emit('connect');
    _self.emit('connected', true);
    _interval = setInterval(() => {
      _ws.ping(_noop);
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
      log.error(_logPrefix, `Unable to parse message ${msg}`, ex);
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
    const now = Date.now();
    const msSinceLastError = now - _lastErrorAt;
    _lastErrorAt = now;
    if (err.code === _lastError && msSinceLastError < 10 * 1000) {
      return;
    }
    _lastError = err.code;
    log.error(_logPrefix, `Client error on ${_wsURL}`, err);
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
        log.error(_logPrefix, 'No WebSocket connection available.');
        reject(new Error('no_connection'));
        return;
      }
      if (_ws.readyState !== WebSocket.OPEN) {
        log.error(_logPrefix, 'WebSocket connection not open.', _ws.readyState);
        reject(new Error('not_open'));
        return;
      }
      _ws.send(msg, (err) => {
        if (err) {
          log.error(_logPrefix, 'Error sending message.', err);
          reject(err);
          return;
        }
        // log.verbose(_logPrefix, 'Message sent.', JSON.parse(msg));
        resolve();
      });
    });
  };

  /**
   * Shutdown the WebSocket client connection
   */
  this.shutdown = function() {
    log.log(_logPrefix, 'Shutting down...');
    _retry = false;
    _clearPingPong();
    if (_ws) {
      _ws.removeAllListeners('open');
      _ws.removeAllListeners('close');
      _ws.removeAllListeners('message');
      _ws.close();
      _ws.removeAllListeners('error');
    }
    _self.emit('shutdown');
  };

  _init();
}
util.inherits(WSClient, EventEmitter);

module.exports = WSClient;
