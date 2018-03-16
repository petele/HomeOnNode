'use strict';

const util = require('util');
const moment = require('moment');
const Keys = require('./Keys').keys;
const log = require('./SystemLog2');
const webpush = require('web-push');
const EventEmitter = require('events').EventEmitter;

const LOG_PREFIX = 'GCMPush';

/**
 * Sends a GCM message
 * @constructor
 *
 * @param {Object} fb Firebase object.
*/
function GCMPush(fb) {
  const _fb = fb;
  const _self = this;
  const _options = {
    gcmAPIKey: Keys.gcm.apiKey,
    TTL: 120,
  };
  let _sendReady = false;
  let _subscribers = [];

  /**
   * Init
  */
  function _init() {
    log.init(LOG_PREFIX, 'Starting...');
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

  /**
   * Send a message
   *
   * @param {Object} srcMessage The message to send.
   * @return {Promise} A promise with the results of the sent messages.
  */
  this.sendMessage = function(srcMessage) {
    if (!srcMessage) {
      log.error(LOG_PREFIX, 'sendMessage() failed, cannot send empty message');
      return Promise.reject(new Error('empty_message_not_allowed'));
    }
    if (typeof srcMessage !== 'object') {
      log.error(LOG_PREFIX, 'sendMessage() failed, message must be an object');
      return Promise.reject(new Error('message_must_be_object'));
    }
    if (_sendReady !== true) {
      log.error(LOG_PREFIX, 'sendMessage() failed, not ready.');
      return Promise.reject(new Error('not_ready'));
    }
    log.log(LOG_PREFIX, 'Sending notifications...');
    const message = Object.assign({}, srcMessage);
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

    return Promise.all(_subscribers.map((subscriberObj) => {
      const key = subscriberObj.key;
      const shortKey = subscriberObj.key.substring(0, 11);
      const subscriber = subscriberObj.subscriptionInfo;
      return new Promise(function(resolve, reject) {
        webpush.sendNotification(subscriber, payload, _options)
        .then((resp) => {
          log.log(LOG_PREFIX, `Message sent to ${shortKey}`);
          log.debug(LOG_PREFIX, '', resp);
          resolve(true);
        })
        .catch((err) => {
          log.error(LOG_PREFIX, `${err.message} for ${shortKey}`, err.body);
          _fb.child(`pushSubscribers/${key}/lastAttemptFailed`).set(true);
          resolve(false);
        });
      });
    }));
  };

  _init();
}

util.inherits(GCMPush, EventEmitter);

module.exports = GCMPush;
