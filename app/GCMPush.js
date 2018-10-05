'use strict';

const util = require('util');
const moment = require('moment');
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
  const _options = {};
  let _sendReady = false;
  const _subscribers = {};

  /**
   * Init
  */
  function _init() {
    log.init(LOG_PREFIX, 'Starting...');
    _fb.child('config/GCMPush').once('value', (snapshot) => {
      const config = snapshot.val();
      _options.gcmAPIKey = config.key;
      _options.TTL = config.ttl || 3600;
      Object.keys(config.subscribers).forEach((key) => {
        _addSubscriber(key, config.subscribers[key]);
      });
      _sendReady = true;
      _self.emit('ready');
    }).then(() => {
      const fbPath = 'config/GCMPush/subscribers';
      _fb.child(fbPath).on('child_added', (snapshot) => {
        const key = snapshot.key();
        _addSubscriber(key, snapshot.val());
      });
      _fb.child(fbPath).on('child_removed', (snapshot) => {
        _removeSubscriber(snapshot.key());
      });
    });
  }

  /**
   * Adds a subscriber to the list
   *
   * @param {string} key The subscriber key.
   * @param {Object} subscriber The subscriber object.
  */
  function _addSubscriber(key, subscriber) {
    if (_subscribers[key]) {
      return;
    }
    subscriber.key = key;
    subscriber.shortKey = key.substring(0, 11);
    _subscribers[key] = subscriber;
    log.log(LOG_PREFIX, `Subscriber added: ${subscriber.shortKey}`);
  }

  /**
   * Removes a subscriber from the list
   *
   * @param {string} key The subscriber key.
  */
  function _removeSubscriber(key) {
    if (!_subscribers[key]) {
      return;
    }
    delete _subscribers[key];
    log.log(LOG_PREFIX, `Subscriber removed: ${key.substring(0, 11)}`);
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

    const promises = [];
    Object.keys(_subscribers).forEach((key) => {
      if (!_subscribers[key]) {
        return;
      }
      const shortKey = _subscribers[key].shortKey;
      const subscriber = _subscribers[key].subscriptionInfo;
      const lprPath = `config/GCMPush/subscribers/${key}/lastResult`;
      const promise = webpush.sendNotification(subscriber, payload, _options)
        .then((resp) => {
          log.log(LOG_PREFIX, `Message sent to ${shortKey}`);
          log.debug(LOG_PREFIX, '', resp);
          return _fb.child(lprPath).set(resp);
        })
        .catch((err) => {
          log.error(LOG_PREFIX, `${err.message} for ${shortKey}`, err.body);
          return _fb.child(lprPath).set(err);
        });
      promises.push(promise);
    });
    return Promise.all(promises);
  };

  _init();
}

util.inherits(GCMPush, EventEmitter);

module.exports = GCMPush;
