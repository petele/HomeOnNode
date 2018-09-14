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
 * @param {Object} dnsAccount DNS account info, user, password, hostname.
 * @fires MyIP#change
 */
function MyIP(dnsAccount) {
  const REFRESH_INTERVAL = 5 * 60 * 1000;
  const _dnsAccount = dnsAccount;
  const _ipifyURL = 'https://api.ipify.org?format=json';
  const _self = this;
  let _dnsTimer;
  this.myIP = null;

  /**
   * Init
  */
  function _init() {
    log.init(LOG_PREFIX, 'Starting...');
    if (_dnsAccount) {
      log.debug(LOG_PREFIX, `DNS update enabled for ${_dnsAccount.hostname}`);
    }
    _getIP();
    setInterval(_getIP, REFRESH_INTERVAL);
  }

  /**
   * Get's the current IP address.
   *  Fires an event (change) when the IP has been updated.
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
         * Fires when the IP address has changed
         * @event MyIP#change
         */
        if (myIP !== _self.myIP) {
          _self.myIP = myIP;
          _self.emit('change', _self.myIP);
          log.log(LOG_PREFIX, `IP Address changed to ${_self.myIP}`);
          _updateDNS();
        }
        return;
      } catch (ex) {
        log.exception(LOG_PREFIX, 'Unable to parse IPify response', ex);
        return;
      }
    });
  }

  /**
   * Updates the Dynamic DNS entry on the Google DNS.
  */
  function _updateDNS() {
    if (!_dnsAccount) {
      return;
    }
    if (_dnsTimer) {
      log.log(LOG_PREFIX, 'DNS update timer active, skipping this request.');
      return;
    }
    const user = _dnsAccount.user;
    const password = _dnsAccount.password;
    const hostname = _dnsAccount.hostname;

    // See https://support.google.com/domains/answer/6147083 for Dynamic DNS API
    const host = `${user}:${password}@domains.google.com`;
    const path = `nic/update?hostname=${hostname}`;

    let requestOptions = {
      uri: `https://${host}/${path}`,
      method: 'POST',
      agent: false,
    };
    log.log(LOG_PREFIX, 'Updating DNS entry...');
    request(requestOptions, (error, response, respBody) => {
      if (error) {
        log.exception(LOG_PREFIX, 'Request error', error);
        return;
      }
      if (respBody.indexOf('good') >= 0 || respBody.indexOf('nochg') >= 0) {
        log.info(LOG_PREFIX, `DNS entry updated: ${respBody}`);
        return;
      }
      if (respBody.indexOf('911') >= 0) {
        log.warn(LOG_PREFIX, `DNS entry update server error, will retry...`);
        _dnsTimer = setTimeout(() => {
          _dnsTimer = null;
          _updateDNS();
        }, 5 * 60 * 1000);
        return;
      }
      log.error(LOG_PREFIX, `DNS entry update failed: ${respBody}`);
    });
  }

  _init();
}

util.inherits(MyIP, EventEmitter);

module.exports = MyIP;
