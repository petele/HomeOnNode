'use strict';

const util = require('util');
const request = require('request');
const log = require('./SystemLog2');
const EventEmitter = require('events').EventEmitter;

const LOG_PREFIX = 'MyIP';

/**
 * MyIP API.
 * @constructor
 *
 * @fires MyIP#change
 */
function MyIP() {
  const REFRESH_INTERVAL = 5 * 60 * 1000;
  const _ipifyURL = 'https://api.ipify.org?format=json';
  const _self = this;
  this.myIP = null;

  /**
   * Init
  */
  function _init() {
    log.init(LOG_PREFIX, 'Starting...');
    _getIP();
    setInterval(_getIP, REFRESH_INTERVAL);
  }

  /**
   * Get's the latest weather.
   *  Fires an event (weather) when the weather has been updated.
  */
  function _getIP() {
    request(_ipifyURL, function(error, response, body) {
      const msg = 'IPify request error';
      if (error) {
        log.error(LOG_PREFIX, msg, error);
        return;
      }
      if (!response) {
        log.error(LOG_PREFIX, msg + ': no response.');
        return;
      }
      if (response.statusCode !== 200) {
        log.error(LOG_PREFIX, msg + ': response code:' + response.statusCode);
        return;
      }
      try {
        const myIPObj = JSON.parse(body);
        const myIP = myIPObj.ip;
        /**
         * Fires when the weather info has changed
         * @event Weather#weather
         */
        if (myIP !== _self.myIP) {
          _self.myIP = myIP;
          _self.emit('change', _self.myIP);
          log.log(LOG_PREFIX, `IP Address changed to ${_self.myIP}`);
        }
        return;
      } catch (ex) {
        log.exception(LOG_PREFIX, 'Unable to parse IPify response', ex);
        return;
      }
    });
  }

  _init();
}

util.inherits(MyIP, EventEmitter);

module.exports = MyIP;
