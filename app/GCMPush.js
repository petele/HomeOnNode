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
  const _options = {
    TTL: 3600,
    headers: {},
  };
  let _sendReady = false;
  const _subscribers = {};

  /**
   * Init
  */
  function _init() {
    log.init(LOG_PREFIX, 'Starting...');
    _fb.child('config/GCMPush').once('value', (snapshot) => {
      const config = snapshot.val();
      _options.vapidDetails = {
        subject: config.vapidKeys.subject,
        privateKey: config.vapidKeys.private,
        publicKey: config.vapidKeys.public,
      };
      if (config.hasOwnProperty('ttl')) {
        _options.TTL = config.ttl;
      }
    }).then(() => {
      const fbPath = 'config/GCMPush/subscribers';
      _fb.child(fbPath).on('child_added', (snapshot) => {
        const key = snapshot.key();
        _addSubscriber(key, snapshot.val());
      });
      _fb.child(fbPath).on('child_removed', (snapshot) => {
        _removeSubscriber(snapshot.key());
      });
    }).then(() => {
      setTimeout(() => {
        _sendReady = true;
        _self.emit('ready');
      }, 1000);
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
    log.debug(LOG_PREFIX, `Subscriber added: ${subscriber.shortKey}`);
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
    log.debug(LOG_PREFIX, `Subscriber removed: ${key.substring(0, 11)}`);
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

    // Generate the message
    const message = Object.assign({}, srcMessage);
    const now = Date.now();
    message.sentAt = now;
    if (!message.tag) {
      message.tag = 'HoN-generic';
    }
    if (message.uniqueTag) {
      message.tag += `-${now}`;
      delete message.uniqueTag;
    }
    if (!message.id) {
      message.id = `HoN-${now}`;
    }
    if (message.appendTime) {
      message.body += ' ' + moment().format('h:mm a (ddd MMM Mo)');
      delete message.appendTime;
    }

    // Set the options for the message
    const options = Object.assign({}, _options);
    if (message.ttl) {
      options.TTL = message.ttl;
      delete message.ttl;
    }
    if (message.urgent) {
      options.headers['Urgency'] = 'high';
      delete message.urgent;
    }

    const payload = JSON.stringify(message);

    // Send the message
    log.debug(LOG_PREFIX, 'Sending notifications...', {message, options});
    const promises = [];
    Object.keys(_subscribers).forEach((key) => {
      if (!_subscribers[key]) {
        return;
      }
      const shortKey = _subscribers[key].shortKey;
      const subscriber = _subscribers[key].subscriptionInfo;
      const fbPath = `config/GCMPush/subscribers/${key}`;

      const promise = webpush.sendNotification(subscriber, payload, options)
          .then((resp) => {
            log.debug(LOG_PREFIX, `Message sent to ${shortKey}`, resp);
            return _fb.child(`${fbPath}/lastResult`).set(resp);
          })
          .catch((err) => {
            if (err.statusCode === 410 || err.statusCode === 404) {
              log.error(LOG_PREFIX, `Removed: ${shortKey}`, err.body);
              return _fb.child(fbPath).remove();
            }
            log.error(LOG_PREFIX, `${err.message} for ${shortKey}`, err.body);
            return _fb.child(`${fbPath}/lastResult`).set(err);
          });
      promises.push(promise);
    });
    return Promise.all(promises);
  };

  _init();
}

util.inherits(GCMPush, EventEmitter);

module.exports = GCMPush;
