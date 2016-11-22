'use strict';

var EventEmitter = require('events').EventEmitter;
var log = require('./SystemLog2');
var util = require('util');
var WebSocket;
try {
  WebSocket = require('ws');
} catch (ex) {
  log.exception(LOG_PREFIX, 'Unable to load WebSocket library', ex);
}

var LOG_PREFIX = 'PUSHBULLET';

function PushBullet(token) {
  var RECONNECT_TIMEOUT = 3;
  var PUSHBULLET_URL = 'wss://stream.pushbullet.com/websocket/';
  var ws;
  var self = this;
  var currentNotifications;
  var pushBulletToken = token;
  var shouldAttemptReconnect = true;

  function handleNop(msg) {
    return false;
  }

  function handleTickle(msg) {
    log.debug(LOG_PREFIX, 'Tickle', msg);
    self.emit('tickle', msg);
    return true;
  }

  function handlePush(msg) {
    if (msg.push && msg.push.type === 'mirror') {
      currentNotifications++;
      log.debug(LOG_PREFIX, 'Notification', msg.push);
      self.emit('notification', msg.push, currentNotifications);
      return true;
    } else if (msg.push && msg.push.type === 'dismissal') {
      if (currentNotifications >= 1) { currentNotifications--; }
      log.debug(LOG_PREFIX, 'Dismissal', msg.push);
      self.emit('dismissal', msg.push, currentNotifications);
      return true;
    }
    log.warn(LOG_PREFIX, 'Unknown push notification', msg);
    return false;
  }

  function wsError(error) {
    var msg = 'Socket Error';
    if (error.message) {
      msg += ': ' + error.message;
    }
    log.error(LOG_PREFIX, msg, error);
    return false;
  }

  function wsClose(code, message) {
    var msg = 'Closed (' + code + ') ' + message;
    log.log(LOG_PREFIX, msg);
    ws = null;
    attemptReconnect();
    self.emit('closed');
  }

  function wsMessageReceived(data, flags) {
    var message = {};
    try {
      message = JSON.parse(data);
    } catch (ex) {
      log.exception(LOG_PREFIX, 'Unable to parse message: ' + data, ex);
      return;
    }
    if (message.type === 'nop') { return handleNop(message); }
    else if (message.type === 'tickle') { return handleTickle(message); }
    else if (message.type === 'push') { return handlePush(message); }
    log.warn(LOG_PREFIX, 'Unknown message type: ' + data);
  }

  function wsPingReceived(data, flags) {
    log.debug(LOG_PREFIX, 'Ping received - ' + data, flags);
  }

  function wsPongReceived(data, flags) {
    log.debug(LOG_PREFIX, 'Pong received - ' + data, flags);
  }

  function wsSocketOpened() {
    log.log(LOG_PREFIX, 'Socket opened.');
    self.emit('ready');
  }

  this.shutdown = function() {
    log.log(LOG_PREFIX, 'Shutdown received.');
    if (ws) {
      shouldAttemptReconnect = false;
      log.debug(LOG_PREFIX, 'Closing WebSocket connection...');
      ws.close();
    }
  };

  function attemptReconnect() {
    if (shouldAttemptReconnect === true) {
      var msg = 'Will attempt reconnect in ' + RECONNECT_TIMEOUT + ' minutes.';
      log.log(LOG_PREFIX, msg);
      setTimeout(function() {
        init();
      }, RECONNECT_TIMEOUT * 60 * 1000);
    }
  }

  function init() {
    log.init(LOG_PREFIX, 'Init');
    if (!WebSocket) {
      log.error(LOG_PREFIX, 'WebSocket library is not available.');
      return;
    }
    if (pushBulletToken) {
      try {
        currentNotifications = 0;
        ws = new WebSocket(PUSHBULLET_URL + pushBulletToken);
        ws.on('error', wsError);
        ws.on('close', wsClose);
        ws.on('message', wsMessageReceived);
        ws.on('ping', wsPingReceived);
        ws.on('pong', wsPongReceived);
        ws.on('open', wsSocketOpened);
      } catch (ex) {
        log.exception(LOG_PREFIX, 'Unable to initialize PushBullet', ex);
        attemptReconnect();
      }  
    } else {
      log.error(LOG_PREFIX, 'No API token provided.');
      self.emit('auth_error');
    }
  }

  init();
}

util.inherits(PushBullet, EventEmitter);

module.exports = PushBullet;
