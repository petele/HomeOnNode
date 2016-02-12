'use strict';

var EventEmitter = require('events').EventEmitter;
var Keys = require('./Keys').keys;
var util = require('util');
var log = require('./SystemLog');
var webRequest = require('./webRequest');

function GCMPush(fb) {
  var _fb = fb;
  var _subscribers = [];
  var _gcmUri = {
    host: 'android.googleapis.com',
    path: '/gcm/send',
    secure: true,
    method: 'POST'
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
      _gcmUri.authorization = 'key=' + Keys.gcm.apiKey;
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
    if (!_gcmUri.authorization) {
      log.error('[GCMPush] No authorization available, aborting.');
      return {error: true, message: 'No authorization'};
    }
    if (_subscribers.length === 0) {
      log.warn('[GCMPush] No subscribers');
      return {error: true, message: 'No subscribers'};
    }
    /* jshint -W106 */
    // jscs:disable requireCamelCaseOrUpperCaseIdentifiers
    var body = {
      registration_ids: _subscribers
    };
    // jscs:enable
    /* jshint +W106 */
    var msg = '[GCMPush] Sending message to ' + _subscribers.length;
    msg += ' devices';
    log.debug(msg);
    try {
      body = JSON.stringify(body);
      webRequest.request(_gcmUri, body, function(resp) {
        if (resp.failure || resp.error) {
          msg = '[GCMPush] Error sending some messages: ';
          msg += JSON.stringify(resp);
          log.error(msg);
        } else {
          log.log('[GCMPush] Sent (' + resp.success + ') messages.');
        }
        if (callback) {
          callback(resp);
        }
      });
      return true;
    } catch (ex) {
      log.exception('[GCMPush] Exception occured while trying to push.', ex);
      if (callback) {
        callback({error: true, exception: ex});
      }
      return false;
    }
  };

  init();
}

util.inherits(GCMPush, EventEmitter);

module.exports = GCMPush;
