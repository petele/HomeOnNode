'use strict';

/* node14_ready */

const util = require('util');
const moment = require('moment');
const log = require('./SystemLog2');
const webpush = require('web-push');
const FBHelper = require('./FBHelper');
const EventEmitter = require('events').EventEmitter;

const LOG_PREFIX = 'GCMPush';

/**
 * Sends a GCM message
 * @constructor
*/
function GCMPush() {
  const _self = this;
  const _options = {
    TTL: 3600,
    headers: {},
  };
  let _fbConfigRef;
  let _sendReady = false;
  const _subscribers = {};

  /**
   * Init
  */
  async function _init() {
    log.init(LOG_PREFIX, 'Starting...');
    const fbRootRef = await FBHelper.getRootRef(30 * 1000);
    _fbConfigRef = await fbRootRef.child('config/GCMPush');
    const gcmConfigSnap = await _fbConfigRef.once('value');
    const gcmConfig = gcmConfigSnap.val();
    _options.vapidDetails = gcmConfig.vapidDetails;
    if (gcmConfig.hasOwnProperty('ttl')) {
      _options.TTL = gcmConfig.ttl;
    }

    const subscribers = gcmConfig.subscribers;
    const keys = Object.keys(subscribers);
    keys.forEach((key) => {
      _addSubscriber(key, subscribers[key]);
    });
    _sendReady = true;
    _self.emit('ready');
    const fbSubscribers = _fbConfigRef.child('subscribers');
    fbSubscribers.on('child_added', (snapshot) => {
      _addSubscriber(snapshot.key, snapshot.val());
    });
    fbSubscribers.on('child_removed', (snapshot) => {
      _removeSubscriber(snapshot.key);
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
      message.body += ' ' + moment().format('h:mm a (ddd MMM Do)');
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
      const fbSubPath = `subscribers/${key}`;

      const promise = webpush.sendNotification(subscriber, payload, options)
          .then((resp) => {
            log.debug(LOG_PREFIX, `Message sent to ${shortKey}`, resp);
            return _fbConfigRef.child(`${fbSubPath}/lastResult`).set(resp);
          })
          .then(() => {
            return true;
          })
          .catch((err) => {
            if (err.statusCode === 410 || err.statusCode === 404) {
              log.error(LOG_PREFIX, `Removed: ${shortKey}`, err.body);
              return _fbConfigRef.child(fbSubPath).remove();
            }
            log.error(LOG_PREFIX, `${err.message} for ${shortKey}`, err.body);
            return _fbConfigRef.child(`${fbSubPath}/lastResult`).set(err);
          });
      promises.push(promise);
    });
    return Promise.all(promises);
  };

  return _init()
      .then(() => {
        return _self;
      })
      .catch((err) => {
        log.exception(LOG_PREFIX, 'Unable to create GCMPush.', err);
        return null;
      });
}

util.inherits(GCMPush, EventEmitter);

module.exports = GCMPush;
