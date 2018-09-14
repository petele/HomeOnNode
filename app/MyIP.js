'use strict';

const util = require('util');
const request = require('request');
const log = require('./SystemLog2');
const EventEmitter = require('events').EventEmitter;

const LOG_PREFIX = 'My_IP';

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
      log.log(LOG_PREFIX, `DNS update enabled for ${_dnsAccount.hostname}`);
      _self.myIP = _dnsAccount.externalIP;
    }
    _getIP();
    setInterval(_getIP, REFRESH_INTERVAL);
  }

  /**
   * Get's the current IP address.
   *  Fires an event (change) when the IP has been updated.
  */
  function _getIP() {
    const LOG_PREFIX = 'IPIFY';
    request(_ipifyURL, function(error, response, body) {
      const msgErr = `IPify request failed.`;
      if (error) {
        log.error(LOG_PREFIX, `${msgErr} (Request Error)`, error);
        return;
      }
      if (!response) {
        log.error(LOG_PREFIX, `${msgErr} (No Response Obj)`);
        return;
      }
      if (response.statusCode !== 200) {
        log.error(LOG_PREFIX, `${msgErr} (${response.statusCode})`, body);
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
          _self.emit('change', myIP);
          log.log(LOG_PREFIX, `IP address changed to: ${myIP}`, body);
          _updateDNS();
        }
        return;
      } catch (ex) {
        const extra = {
          exception: ex,
          respBody: body,
        };
        log.exception(LOG_PREFIX, `${msgErr} (Parse Response)`, extra);
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
    const LOG_PREFIX = 'G_DNS';
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
    request(requestOptions, (error, response, body) => {
      const msgErr = `DNS update failed.`;
      const msgOK = `DNS updated.`;
      if (error) {
        log.exception(LOG_PREFIX, `${msgErr} (Request Error)`, error);
        return;
      }
      if (body.indexOf('good') >= 0 || body.indexOf('nochg') >= 0) {
        log.info(LOG_PREFIX, msgOK, body);
        return;
      }
      if (body.indexOf('911') >= 0) {
        log.warn(LOG_PREFIX, `${msgErr} (Server Error), will retry.`, body);
        _dnsTimer = setTimeout(() => {
          _dnsTimer = null;
          _updateDNS();
        }, 5 * 60 * 1000);
        return;
      }
      log.error(LOG_PREFIX, msgErr, body);
    });
  }

  _init();
}

util.inherits(MyIP, EventEmitter);

module.exports = MyIP;
