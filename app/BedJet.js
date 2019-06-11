'use strict';

const util = require('util');
const log = require('./SystemLog2');
const diff = require('deep-diff').diff;
const EventEmitter = require('events').EventEmitter;

const LOG_PREFIX = 'BEDJET';

/**
 * BedJet API.
 * @constructor
 *
 * @param {String} ipAddress IP Address of the BedJet.
 * @fires BedJet#change
 * @fires BedJet#error
*/
function BedJet(ipAddress) {
  this.state = null;
  let _ready = false;
  let _timer = null;
  const _self = this;
  const _ipAddress = ipAddress;
  const REFRESH_INTERVAL = 4 * 60 * 1000;
  const MAX_REFRESH_INTERVAL = 30 * 60 * 1000;

  /**
   * Init
   */
  function _init() {
    log.init(LOG_PREFIX, 'Starting...', {ipAddress: _ipAddress});
    _getDeviceInfo()
        .then(() => {
          _monitorBedJet(REFRESH_INTERVAL);
        })
        .catch((err) => {
          log.exception(LOG_PREFIX, 'Unable to initialize bedJet', err);
          _self.emit(`error`, err);
        });
  }

  /**
   * Sets the state of the BedJet.
   *
   * @param {Object} opts Options
   * @return {Promise} result of request.
   */
  this.setState = function(opts) {
    const msg = `setState(...)`;
    if (!_ready) {
      log.error(LOG_PREFIX, `${msg} failed, not ready.`, opts);
      return Promise.reject(new Error('not_ready'));
    }
    log.debug(LOG_PREFIX, msg, opts);
    // TODO
    log.todo(LOG_PREFIX, `setState(...) Not Yet Implemented.`);
    _getDeviceInfo();
    return Promise.resolve('Not Yet Implemented');
  };

  /**
   * Start the BedJet monitor interval.
   *
   * @param {Number} delay Number of MS to wait to be called again.
   */
  function _monitorBedJet(delay) {
    _timer = setTimeout(() => {
      _timer = null;
      _getDeviceInfo()
          .then(() => {
            _monitorBedJet(REFRESH_INTERVAL);
          })
          .catch((err) => {
            const msg = `Failed to update BedJet state (monitor)`;
            log.exception(LOG_PREFIX, msg, err);
            if (delay < MAX_REFRESH_INTERVAL) {
              delay += REFRESH_INTERVAL;
            }
            _monitorBedJet(delay);
          });
    }, delay);
  }

  /**
   * Ping the BedJet and get the current state.
   *
   * @return {Promise} Object of BedJet state.
   */
  function _getDeviceInfo() {
    log.verbose(LOG_PREFIX, `_getDeviceInfo()`);
    if (_timer) {
      log.verbose(LOG_PREFIX, `existing timer scheduled`);
    }
    return Promise.resolve()
        .then(() => {
          log.todo(LOG_PREFIX, `getDeviceInfo() Not Yet Implemented.`);
          return null;
        })
        .then((newState) => {
          if (diff(_self.state, newState)) {
            _self.state = newState;
            if (_ready) {
              _self.emit('change', newState);
            } else {
              _ready = true;
              _self.emit('ready', newState);
            }
          }
          return _self.state;
        });
  }

  _init();
}

util.inherits(BedJet, EventEmitter);

module.exports = BedJet;
