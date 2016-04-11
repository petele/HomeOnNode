'use strict';

var EventEmitter = require('events').EventEmitter;
var Keys = require('./Keys').keys;
var util = require('util');
var log = require('./SystemLog');
var webpush = require('web-push-encryption');

function GCMPush(fb) {
  var _fb = fb;
  var _self = this;
  var _sendReady = false;

  /*****************************************************************************
   *
   * Internal functions
   *
   ****************************************************************************/

  function init() {
    log.init('[GCMPush] Init');
    setTimeout(function() {
      _sendReady = true;
      _self.emit('ready');
    }, 250);
  }

  /*****************************************************************************
   *
   * Public API
   *
   ****************************************************************************/

  this.sendMessage = function(message) {
    var msg;
    if (message && typeof message === 'object') {
      message = JSON.stringify(message);
      _fb.child('pushSubscribers').once('value', function(snapshot) {
        log.log('[GCMPush] Sending notifications...');
        snapshot.forEach(function(subscriberObj) {
          var subscriber = subscriberObj.val();
          var subscriberKey = subscriberObj.key();
          var subscription = subscriber.subscriptionInfo;
          if (subscriber.subscriptionInfo.keys) {
            webpush.sendWebPush(message, subscription, Keys.gcm.apiKey)
              .then(function(resp) {
                msg = '[GCMPush] Message sent to ' + subscriberKey;
                msg += ' - ' + JSON.stringify(resp);
                log.debug(msg);
              })
              .catch(function(resp) {
                msg = '[GCMPush] Error sending message to ' + subscriberKey;
                msg += ' - ' + JSON.stringify(resp);
                log.warn(msg);
              });
          } else {
            msg = '[GCMPush] Subscriber (' + subscriberKey + ') had no keys.';
            msg += ' Removed.';
            log.warn(msg);
            subscriberObj.ref().remove();
          }
        });
      });
    } else {
      log.error('[GCMPush] No or invalid message provided. Nothing sent.');
    }
  };

  init();
}

util.inherits(GCMPush, EventEmitter);

module.exports = GCMPush;
