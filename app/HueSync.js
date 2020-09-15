'use strict';

const util = require('util');
const https = require('https');
const fetch = require('node-fetch');
const log = require('./SystemLog2');
const diff = require('deep-diff').diff;
const honHelpers = require('./HoNHelpers');
const EventEmitter = require('events').EventEmitter;

const LOG_PREFIX = 'HUE_SYNC';

/**
 * Philips Hue Sync API.
 * @constructor
 *
 * @param {String} ipAddress IP Address of the Hub
 * @param {String} bearerToken Bearer token
 */
function HueSync(ipAddress, bearerToken) {
  const REQUEST_TIMEOUT = 15 * 1000;
  const CONFIG_REFRESH_INTERVAL = 3 * 60 * 1000;
  const _self = this;

  const _ipAddress = ipAddress;
  const _bearerToken = bearerToken;
  let _httpAgent;

  let _ready = false;
  let _connectionStarted = false;

  this.deviceInfo = {};

  /**
   * Connect to the Hue bridge for the first time.
   * @param {Boolean} retry
   */
  this.connect = async function(retry) {
    if (_ready) {
      return true;
    }
    if (_connectionStarted) {
      log.warn(LOG_PREFIX, 'Connection attempt already in progress...');
      return false;
    }
    _connectionStarted = true;
    log.init(LOG_PREFIX, 'Connecting...');
    try {
      await _updateConfig();
    } catch (ex) {
      if (retry) {
        _retryInitialConnection(retry);
      } else {
        _connectionStarted = false;
      }
      return false;
    }
    setTimeout(() => {
      _updateConfigTick();
    }, CONFIG_REFRESH_INTERVAL);
    _ready = true;
    return true;
  };

  this.executeCommand = async function(command) {};

  /**
   * Retry the initial connection if it didn't succeed.
   *
   * @param {Boolean} [retry]
   */
  function _retryInitialConnection(retry) {
    setTimeout(() => {
      _connectionStarted = false;
      _self.connect(retry);
    }, 90 * 1000);
  }

  /**
   * Updates this.dataStore to the latest state from the hub.
   *
   * @param {Boolean} retry Should it retry the connection.
   * @return {Promise<Object>} Device info.
   */
  async function _updateConfig(retry) {
    const deviceInfo = await _makeRequest('', 'GET', null, retry);

    if (diff(_self.deviceInfo, deviceInfo)) {
      _self.deviceInfo = deviceInfo;
      _self.emit('config_changed', _self.deviceInfo);
    }
    return _self.deviceInfo;
  }

  /**
   * Timer tick for updating config information.
   * @return {Promise}
   */
  async function _updateConfigTick() {
    try {
      await _updateConfig(true);
    } catch (ex) {
      log.error(LOG_PREFIX, 'Unable to update config.', ex);
    }
    await honHelpers.sleep(CONFIG_REFRESH_INTERVAL);
    return _updateConfigTick();
  }

  this.isReady = function() {
    return _ready;
  };

  this.getConfig = async function() {
    if (!_ready) {
      log.error(LOG_PREFIX, `Not ready.`);
      return null;
    }
    return _updateConfig(false);
  };

  this.setSyncActive = async function(enabled) {
    if (!_ready) {
      log.error(LOG_PREFIX, `Not ready.`);
      return null;
    }
  };

  this.setHDMIActive = async function(enabled) {
    if (!_ready) {
      log.error(LOG_PREFIX, `Not ready.`);
      return null;
    }
  };

  this.setMode = async function(mode) {
    if (!_ready) {
      log.error(LOG_PREFIX, `Not ready.`);
      return null;
    }
  };

  this.setHDMISource = async function(input) {
    if (!_ready) {
      log.error(LOG_PREFIX, `Not ready.`);
      return null;
    }
  };

  /**
   * Gets the HTTP Agent.
   *
   * @return {Agent} HTTP Agent
   */
  function _getAgent() {
    if (_httpAgent) {
      return _httpAgent;
    }
    const agentOpts = {
      rejectUnauthorized: false,
    };
    _httpAgent = new https.Agent(agentOpts);
    return _httpAgent;
  }

  /**
   * Helper function to make a Hue request
   *
   * @param {String} requestPath the URL/request path to hit
   * @param {String} method the HTTP method to use
   * @param {Object} [body] The body to send along with the request
   * @param {Boolean} [retry] If the request fails, should it retry
   * @return {Promise} A promise that resolves with the response
  */
  async function _makeRequest(requestPath, method, body, retry) {
    const url = `https://${_ipAddress}/api/v1${requestPath}`;
    const msg = `makeRequest('${method}', '${requestPath}', ${retry})`;
    const fetchOpts = {
      method: method || 'GET',
      timeout: REQUEST_TIMEOUT,
      headers: {
        Authorization: `Bearer ${_bearerToken}`,
      },
      agent: _getAgent(),
    };
    if (body) {
      fetchOpts.body = JSON.stringify(body);
      fetchOpts.headers['Content-Type'] = 'application/json';
    }
    let resp;
    try {
      log.verbose(LOG_PREFIX, `${msg}`, body);
      resp = await fetch(url, fetchOpts);
    } catch (ex) {
      log.error(LOG_PREFIX, `${msg} - Request error`, ex);
      if (retry) {
        await honHelpers.sleep(250);
        return _makeRequest(requestPath, method, body, false);
      }
      throw ex;
    }

    if (!resp.ok) {
      log.error(LOG_PREFIX, `${msg} - Response error`, resp);
      if (retry) {
        await honHelpers.sleep(250);
        return _makeRequest(requestPath, method, body, false);
      }
      throw new Error('Response Error');
    }

    let respBody;
    try {
      respBody = await resp.json();
    } catch (ex) {
      log.error(LOG_PREFIX, `${msg} - JSON error`, ex);
      if (retry) {
        await honHelpers.sleep(250);
        return _makeRequest(requestPath, method, body, false);
      }
      throw new Error('JSON Conversion Error');
    }

    const errors = [];
    if (respBody.error) {
      log.verbose(LOG_PREFIX, `${msg} Response error: body.`, respBody);
      errors.push(respBody);
    } else if (Array.isArray(respBody)) {
      respBody.forEach((item) => {
        if (item.error) {
          log.verbose(LOG_PREFIX, `${msg} Response error: item.`, item);
          errors.push(item);
        }
      });
    }

    if (errors.length === 0) {
      return respBody;
    }

    if (retry) {
      log.warn(LOG_PREFIX, `${msg} - will retry.`, errors);
      await honHelpers.sleep(250);
      return _makeRequest(requestPath, method, body, false);
    }

    log.error(LOG_PREFIX, `${msg} - will retry.`, errors);
    throw new Error('Failed');
  }
}

util.inherits(HueSync, EventEmitter);

module.exports = HueSync;
