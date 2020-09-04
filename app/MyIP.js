'use strict';

/* node14_ready */

const util = require('util');
const fetch = require('node-fetch');
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
  const _self = this;
  this.myIP = null;

  /**
   * Init
  */
  function _init() {
    log.init(LOG_PREFIX, 'Starting...');
    if (_dnsAccount) {
      log.log(LOG_PREFIX, `DNS update enabled for '${_dnsAccount.hostname}'`);
    }
    _getIP();
    setInterval(_getIP, REFRESH_INTERVAL);
  }

  /**
   * Get's the current IP address.
   *  Fires an event (change) when the IP has been updated.
  */
  async function _getIP() {
    let ip;
    try {
      const resp = await fetch('https://domains.google.com/checkip');
      if (!resp.ok) {
        log.exception(LOG_PREFIX, 'Invalid server response.', resp);
        return;
      }
      const respTXT = await resp.text();
      ip = respTXT.trim();
    } catch (ex) {
      log.exception(LOG_PREFIX, 'Unable to get IP address.', ex);
      return;
    }
    if (!ip) {
      log.exception(LOG_PREFIX, 'Invalid IP response.', ip);
      return;
    }
    if (ip !== _self.myIP) {
      _self.myIP = ip;
      log.log(LOG_PREFIX, `IP address changed to: ${ip}`);
      _self.emit('change', ip);
      _updateDNS();
    }
  }

  /**
   * Updates the Dynamic DNS entry on the Google DNS.
  */
  async function _updateDNS() {
    if (!_dnsAccount) {
      return;
    }
    const LOG_PREFIX = 'G_DNS';

    const user = _dnsAccount.user;
    const password = _dnsAccount.password;
    const hostname = _dnsAccount.hostname;

    log.debug(LOG_PREFIX, 'Updating DNS entry...');

    // See https://support.google.com/domains/answer/6147083 for Dynamic DNS API
    const host = `${user}:${password}@domains.google.com`;
    const path = `nic/update?hostname=${hostname}`;
    const url = `https://${host}/${path}`;
    const fetchOpts = {
      method: 'post',
    };

    let respTXT;
    try {
      const resp = await fetch(url, fetchOpts);
      if (!resp.ok) {
        log.exception(LOG_PREFIX, 'Server error', resp);
        return;
      }
      respTXT = await resp.text();
    } catch (ex) {
      log.exception(LOG_PREFIX, 'DNS update failed.', ex);
    }
    if (respTXT.includes('good') || respTXT.includes('nochg')) {
      log.log(LOG_PREFIX, 'DNS updated successfully.', respTXT);
      return;
    }
    log.error(LOG_PREFIX, 'DNS update failed.', respTXT);
  }

  _init();
}

util.inherits(MyIP, EventEmitter);

module.exports = MyIP;
