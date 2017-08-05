'use strict';

const util = require('util');
const log = require('./SystemLog2');
const WSClient = require('./WSClient');
const EventEmitter = require('events').EventEmitter;

const LOG_PREFIX = 'PUSHBULLET';

/**
 * PushBullet API
 * @constructor
 *
 * @fires PushBullet#auth_error
 * @fires PushBullet#tickle
 * @fires PushBullet#dismissal
 * @fires PushBullet#notification
 * @param {String} token - The PushBullet API token
*/
function PushBullet(token) {
  const PUSHBULLET_URL = 'wss://stream.pushbullet.com/websocket/';
  const _self = this;
  let _wsClient;
  const _pushBulletToken = token;


  /**
   * Shutdown the web socket.
  */
  this.shutdown = function() {
    log.log(LOG_PREFIX, 'Shutdown received.');
    if (_wsClient) {
      log.debug(LOG_PREFIX, 'Closing WebSocket connection...');
      _wsClient.shutdown();
    }
  };

  /**
   * Init
  */
  function _init() {
    log.init(LOG_PREFIX, 'Starting...');
    if (!_pushBulletToken) {
      log.error(LOG_PREFIX, 'No API token provided.');
      _self.emit('auth_error');
      return;
    }
    const wsURL = PUSHBULLET_URL + _pushBulletToken;
    _wsClient = new WSClient(wsURL, true);
    _wsClient.on('message', _wsMessageReceived);
  }

  /**
   * Handle an incoming push message
   *
   * @param {Object} msg PushBullet message
  */
  function _handlePush(msg) {
    const details = {
      type: msg.push.type,
      title: msg.push.title,
      body: msg.push.body,
      appName: msg.push.application_name,
      pkgName: msg.push.package_name,
    };
    log.verbose(LOG_PREFIX, `handlePush()`, details);
    if (msg.push.type === 'mirror') {
      _self.emit('notification', msg.push);
      return;
    }
    if (msg.push.type === 'dismissal') {
      _self.emit('dismissal', msg.push);
      return;
    }
    log.warn(LOG_PREFIX, 'Unknown push notification', msg);
    return;
  }

  /**
   * Web Socket Message Received
   *
   * @param {Object} message WebSocket message.
  */
  function _wsMessageReceived(message) {
    if (message.type === 'nop') {
      return;
    }
    if (message.type === 'tickle') {
      log.verbose(LOG_PREFIX, 'Tickle', message);
      _self.emit('tickle', message);
      return;
    }
    if (message.type === 'push' && message.push) {
      _handlePush(message);
      return;
    }
    log.warn(LOG_PREFIX, `Unknown message type: ${message.type}`, message);
  }

  _init();
}

util.inherits(PushBullet, EventEmitter);

module.exports = PushBullet;
