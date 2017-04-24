'use strict';

const util = require('util');
const moment = require('moment');
const Keys = require('./Keys').keys;
const log = require('./SystemLog2');
const webpush = require('web-push');
const EventEmitter = require('events').EventEmitter;

const LOG_PREFIX = 'GCMPush';

function GCMPush(fb) {
  const _fb = fb;
  const _self = this;
  const _options = {
    gcmAPIKey: Keys.gcm.apiKey,
    TTL: 120,
  };
  let _sendReady = false;
  let _subscribers = [];


  /*****************************************************************************
   *
   * Internal functions
   *
   ****************************************************************************/

  function init() {
    log.init(LOG_PREFIX, 'Init');
    _fb.child('pushSubscribers').on('value', (snapshot) => {
      let subscribers = [];
      snapshot.forEach((subscriberObj) => {
        let subscriber = subscriberObj.val();
        subscriber.key = subscriberObj.key();
        subscribers.push(subscriber);
      });
      _subscribers = subscribers;
      log.log(LOG_PREFIX, `Subscribers updated: ${_subscribers.length}`);
      if (_sendReady === false) {
        _sendReady = true;
        _self.emit('ready');
      }
    });
  }

  /*****************************************************************************
   *
   * Public API
   *
   ****************************************************************************/

  this.sendMessage = function(message) {
    if (!message) {
      log.error(LOG_PREFIX, 'sendMessage() failed, cannot send empty message');
      return;
    }
    if (typeof message !== 'object') {
      log.error(LOG_PREFIX, 'sendMessage() failed, message must be an object');
      return;
    }
    if (_sendReady !== true) {
      log.error(LOG_PREFIX, 'sendMessage() failed, not ready.');
      return;
    }
    log.log(LOG_PREFIX, 'Sending notifications...');
    const now = Date.now();
    message.sentAt = now;
    if (!message.tag) {
      message.tag = 'HoN-generic';
    }
    if (!message.id) {
      message.id = 'HoN-' + now.toString();
    }
    if (message.appendTime) {
      message.body += ' ' + moment().format('h:mm a (ddd MMM Mo)');
    }
    const payload = JSON.stringify(message);
    _subscribers.forEach((subscriberObj) => {
      const key = subscriberObj.key;
      const shortKey = subscriberObj.key.substring(0, 11);
      const subscriber = subscriberObj.subscriptionInfo;
      webpush.sendNotification(subscriber, payload, _options)
        .then((resp) => {
          log.log(LOG_PREFIX, `Message sent to ${shortKey}`);
        })
        .catch((err) => {
          log.error(LOG_PREFIX, `${err.message} for ${shortKey}`, err.body);
          _fb.child(`pushSubscribers/${key}/lastAttemptFailed`).set(true);
        });
    });
  };

  init();
}

util.inherits(GCMPush, EventEmitter);

module.exports = GCMPush;
