'use strict';

const EventEmitter = require('events').EventEmitter;
const log = require('./SystemLog2');
const util = require('util');
const WebSocket = require('ws');

const LOG_PREFIX = 'PUSHBULLET';

/**
 * PushBullet API
 * @constructor
 *
 * @fires PushBullet#dismissal
 * @fires PushBullet#notification
 * @param {String} token - The PushBullet API token
*/
function PushBullet(token) {
  const RECONNECT_TIMEOUT = 3;
  const PUSHBULLET_URL = 'wss://stream.pushbullet.com/websocket/';
  let _ws;
  const _self = this;
  let _currentNotifications;
  const _pushBulletToken = token;
  let _shouldAttemptReconnect = true;

  /**
   * Shutdown the web socket.
  */
  this.shutdown = function() {
    log.log(LOG_PREFIX, 'Shutdown received.');
    if (_ws) {
      _shouldAttemptReconnect = false;
      log.debug(LOG_PREFIX, 'Closing WebSocket connection...');
      _ws.close();
    }
  };

  /**
   * Init
  */
  function _init() {
    log.init(LOG_PREFIX, 'Starting...');
    if (!WebSocket) {
      log.error(LOG_PREFIX, 'WebSocket library is not available.');
      return;
    }
    if (_pushBulletToken) {
      try {
        _currentNotifications = 0;
        _ws = new WebSocket(PUSHBULLET_URL + _pushBulletToken);
        _ws.on('error', _wsError);
        _ws.on('close', _wsClose);
        _ws.on('message', _wsMessageReceived);
        _ws.on('ping', _wsPingReceived);
        _ws.on('pong', _wsPongReceived);
        _ws.on('open', _wsSocketOpened);
      } catch (ex) {
        log.exception(LOG_PREFIX, 'Unable to initialize PushBullet', ex);
        _attemptReconnect();
      }
    } else {
      log.error(LOG_PREFIX, 'No API token provided.');
      _self.emit('auth_error');
    }
  }

  /**
   * Ignore the message and do nothing
   *
   * @param {Object} msg PushBullet message
   * @return {Boolean} Always returns false.
  */
  function _handleNop(msg) {
    return false;
  }

  /**
   * Handle an incoming tickle
   *
   * @fires PushBullet#tickle
   * @param {Object} msg PushBullet message
   * @return {Boolean} Always returns true.
  */
  function _handleTickle(msg) {
    log.debug(LOG_PREFIX, 'Tickle', msg);
    _self.emit('tickle', msg);
    return true;
  }

  /**
   * Handle an incoming push message
   *
   * @fires PushBullet#notification
   * @fires PushBullet#dismissal
   * @param {Object} msg PushBullet message
   * @return {Boolean} True if handled, false if unknown message type
  */
  function _handlePush(msg) {
    if (msg.push && msg.push.type === 'mirror') {
      _currentNotifications++;
      log.debug(LOG_PREFIX, `emit('notification', '${msg.push.package_name}')`);
      // log.debug(LOG_PREFIX, 'Notification', msg.push);
      /**
       * Fired when a new message has been received
       * @event PushBullet#notification
       */
      _self.emit('notification', msg.push, _currentNotifications);
      return true;
    } else if (msg.push && msg.push.type === 'dismissal') {
      if (_currentNotifications >= 1) { _currentNotifications--; }
      log.debug(LOG_PREFIX, `emit('dismissal', '${msg.push.package_name}')`);
      // log.debug(LOG_PREFIX, 'Dismissal', msg.push);
      /**
       * Fired when a notification has been dismissed.
       * @event PushBullet#dismissal
       */
      _self.emit('dismissal', msg.push, _currentNotifications);
      return true;
    }
    log.warn(LOG_PREFIX, 'Unknown push notification', msg);
    return false;
  }

  /**
   * Handle a Web Socket error
   *
   * @param {Object} error The WebSocket error
   * @return {Boolean} Always returns false.
  */
  function _wsError(error) {
    let msg = 'Socket Error';
    if (error.message) {
      msg += ': ' + error.message;
    }
    log.error(LOG_PREFIX, msg, error);
    return false;
  }

  /**
   * Closes the web socket
   *
   * @param {Number} code The error code
   * @param {String} message The error message.
  */
  function _wsClose(code, message) {
    log.log(LOG_PREFIX, `Closed (${code}) ${message}`);
    _ws = null;
    _self.emit('closed');
    _attemptReconnect();
  }

  /**
   * Web Socket Message Received
   *
   * @param {Object} data WebSocket message.
   * @param {Object} flags Not used.
   * @return {Boolean} True if the message was used or false if thrown away.
  */
  function _wsMessageReceived(data, flags) {
    let message = {};
    try {
      message = JSON.parse(data);
    } catch (ex) {
      log.exception(LOG_PREFIX, 'Unable to parse message: ' + data, ex);
      return;
    }
    if (message.type === 'nop') {
      return _handleNop(message);
    } else if (message.type === 'tickle') {
      return _handleTickle(message);
    } else if (message.type === 'push') {
      return _handlePush(message);
    }
    log.warn(LOG_PREFIX, 'Unknown message type: ' + data);
  }

  /**
   * Web Socket Ping Received
   *
   * @param {Object} data WebSocket message.
   * @param {Object} flags Not used.
  */
  function _wsPingReceived(data, flags) {
    log.debug(LOG_PREFIX, 'Ping received - ' + data, flags);
  }

  /**
   * Web Socket Pong Received
   *
   * @param {Object} data WebSocket message.
   * @param {Object} flags Not used.
  */
  function _wsPongReceived(data, flags) {
    log.debug(LOG_PREFIX, 'Pong received - ' + data, flags);
  }

  /**
   * Web Socket Opened.
  */
  function _wsSocketOpened() {
    log.log(LOG_PREFIX, 'Socket opened.');
    _self.emit('ready');
  }

  /**
   * Attempt to reconnect to the PushBullet WebSocket
  */
  function _attemptReconnect() {
    if (_shouldAttemptReconnect === true) {
      const msg = `Will attempt reconnect in ${RECONNECT_TIMEOUT} minutes.`;
      log.log(LOG_PREFIX, msg);
      setTimeout(function() {
        _init();
      }, RECONNECT_TIMEOUT * 60 * 1000);
    }
  }

  _init();
}

util.inherits(PushBullet, EventEmitter);

module.exports = PushBullet;
