'use strict';

var EventEmitter = require('events').EventEmitter;
var Keys = require('./Keys').keys;
var util = require('util');
var log = require('./SystemLog2');
var webpush = require('web-push-encryption');
var moment = require('moment');

var LOG_PREFIX = 'GCMPush';

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
    log.init(LOG_PREFIX, 'Init');
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
      var now = Date.now();
      message.sentAt = now;
      if (!message.tag) {
        message.tag = 'HoN-generic';
      }
      if (!message.id) {
        message.id = 'HoN-' + now;
      }
      if (message.appendTime) {
        message.body += ' ' + moment().format('h:mm a (ddd MMM Mo)');
      }
      message = JSON.stringify(message);
      _fb.child('pushSubscribers').once('value', function(snapshot) {
        log.log(LOG_PREFIX, 'Sending notifications...');
        snapshot.forEach(function(subscriberObj) {
          var subscriber = subscriberObj.val();
          var subscriberKey = subscriberObj.key();
          var subscription = subscriber.subscriptionInfo;
          if (subscriber.subscriptionInfo.keys) {
            webpush.sendWebPush(message, subscription, Keys.gcm.apiKey)
              .then(function(resp) {
                msg = 'Message sent to ' + subscriberKey;
                msg += ' - ' + JSON.stringify(resp);
                log.debug(LOG_PREFIX, msg);
              })
              .catch(function(resp) {
                msg = 'Error sending message to ' + subscriberKey;
                msg += ' - ' + JSON.stringify(resp);
                log.warn(LOG_PREFIX, msg);
              });
          } else {
            msg = 'Subscriber (' + subscriberKey + ') had no keys.';
            msg += ' Removed.';
            log.warn(LOG_PREFIX, msg);
            subscriberObj.ref().remove();
          }
        });
      });
    } else {
      log.error(LOG_PREFIX, 'No or invalid message provided. Nothing sent.');
    }
  };

  init();
}

util.inherits(GCMPush, EventEmitter);

module.exports = GCMPush;
