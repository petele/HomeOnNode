'use strict';

var EventEmitter = require('events').EventEmitter;
var Keys = require('./Keys').keys;
var util = require('util');
var log = require('./SystemLog');
var request = require('request');

function GCMPush(fb) {
  var _fb = fb;
  var _subscribers = [];
  var _gcmReq = {
    url: 'https://android.googleapis.com/gcm/send',
    method: 'POST',
    headers: {},
    json: true
  };
  var _self = this;
  var _sentReady = false;

  /*****************************************************************************
   *
   * Internal functions
   *
   ****************************************************************************/

  function init() {
    log.init('[GCMPush] Init');
    if (Keys.gcm) {
      _gcmReq.headers.Authorization = 'key=' + Keys.gcm.apiKey;
    } else {
      log.error('[GCMPush] Key not set, unable to send messages.');
      return;
    }
    _fb.child('pushSubscribers').on('value', function(snapshot) {
      var keys = Object.keys(snapshot.val());
      if (keys) {
        log.debug('[GCMPush] pushSubscribers updated: ' + keys.length);
        _subscribers = keys;
      } else {
        log.debug('[GCMPush] pushSubscribers updated, no subscribers');
        _subscribers = [];
      }
      if (_sentReady === false) {
        log.log('[GCMPush] Ready');
        _sentReady = true;
        _self.emit('ready');
      }
    });
  }

  /*****************************************************************************
   *
   * Public API
   *
   ****************************************************************************/

  this.send = function(callback) {
    return this.sendMessage(null, callback);
  };

  this.sendMessage = function(message, callback) {
    if (message) {
      log.warn('[GCMPush] Message not supported, sending empty message');
    }
    if (!_gcmReq.headers.Authorization) {
      log.error('[GCMPush] No authorization available, aborting.');
      return {error: true, message: 'No authorization'};
    }
    if (_subscribers.length === 0) {
      log.warn('[GCMPush] No subscribers');
      return {error: true, message: 'No subscribers'};
    }
    /* jshint -W106 */
    // jscs:disable requireCamelCaseOrUpperCaseIdentifiers
    _gcmReq.body = {registration_ids: _subscribers};
    // jscs:enable
    /* jshint +W106 */
    var msg = '[GCMPush] Sending message to ' + _subscribers.length;
    msg += ' devices';
    log.debug(msg);
    request(_gcmReq, function(error, response, body) {
      if (error) {
        log.exception('[GCMPush] Failed', error);
      } else if (response && response.statusCode !== 200) {
        log.error('[GCMPush] Status code error (' + response.statusCode + ')');
      } else if (body.failure || body.error) {
        msg = '[GCMPush] Error sending some messages: ' + JSON.stringify(body);
        log.error(msg);
      } else {
        log.log('[GCMPush] Sent (' + body.success + ') messages.');
      }
      if (callback) {
        callback(body);
      }
    });
    return true;
  };

  init();
}

util.inherits(GCMPush, EventEmitter);

module.exports = GCMPush;
