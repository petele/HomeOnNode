'use strict';

const util = require('util');
const https = require('https');
const fetch = require('node-fetch');
const log = require('./SystemLog2');
const diff = require('deep-diff').diff;
const honHelpers = require('./HoNHelpers');
const EventEmitter = require('events').EventEmitter;

const LOG_PREFIX = 'HUE_SYNC';

const ENUM_INTENSITY = ['subtle', 'moderate', 'high', 'intense'];
const ENUM_MODES = [
  'powersave', 'passthrough', 'video', 'game', 'music', 'ambient',
];

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
  const AGENT_OPTS = {
    rejectUnauthorized: false,
    maxSockets: 4,
    port: 443,
    host: ipAddress,
    keepAlive: true,
  };

  const _self = this;
  const _bearerToken = bearerToken;
  const _ipAddress = ipAddress;
  const _httpAgent = new https.Agent(AGENT_OPTS);

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
    const defaultOpts = {
      intensityValues: ENUM_INTENSITY.slice(),
      modeValues: ENUM_MODES.slice(),
    };
    _self.emit('ready', defaultOpts);
    return true;
  };

  this.isReady = function() {
    return _ready;
  };

  this.executeCommand = async function(command) {
    if (!_ready) {
      throw new Error('not_ready');
    }
    const promises = [];
    if (command.hasOwnProperty('syncActive')) {
      promises.push(_setSyncActive(command.syncActive));
    }
    if (command.hasOwnProperty('hdmiActive')) {
      promises.push(_setHDMIActive(command.hdmiActive));
    }
    if (command.hasOwnProperty('mode')) {
      promises.push(_setMode(command.mode));
    }
    if (command.hasOwnProperty('hdmiSource')) {
      promises.push(_setHDMISource(command.hdmiSource));
    }
    if (command.hasOwnProperty('intensity')) {
      promises.push(_setIntensity(command.intensity));
    }
    if (command.hasOwnProperty('brightness')) {
      promises.push(_setBrightness(command.brightness));
    }
    if (command.hasOwnProperty('refresh')) {
      promises.push(Promise.resolve());
    }
    if (promises.length === 0) {
      log.error(LOG_PREFIX, 'Unrecognized command', command);
      throw new Error('Unrecognized command');
    }
    try {
      const results = await Promise.all(promises);
      await _updateConfig();
      return results;
    } catch (ex) {
      log.error(LOG_PREFIX, 'Error in execCommand', ex);
      throw ex;
    }
  };

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

  /**
   * Enables or disables the Hue Sync
   * @param {Boolean} enabled
   */
  async function _setSyncActive(enabled) {
    if (!_ready) {
      log.error(LOG_PREFIX, `Not ready.`);
      return null;
    }
    const path = '/execution';
    const body = {syncActive: !!enabled};
    return _makeRequest(path, 'PUT', body, true);
  }

  /**
   * Set PowerSave or Passthrough mode.
   * @param {Boolean} enabled True for Passthrough
   */
  async function _setHDMIActive(enabled) {
    if (!_ready) {
      log.error(LOG_PREFIX, `Not ready.`);
      return null;
    }
    const path = '/execution';
    const body = {hdmiActive: !!enabled};
    return _makeRequest(path, 'PUT', body, true);
  }

  /**
   * Sets the mode of the device.
   * @param {String} mode
   */
  async function _setMode(mode) {
    if (!_ready) {
      log.error(LOG_PREFIX, `Not ready.`);
      return null;
    }
    if (!ENUM_MODES.includes(mode)) {
      log.error(LOG_PREFIX, 'Invalid mode value', mode);
      throw new Error('Invalid input');
    }
    const path = '/execution';
    const body = {mode: mode};
    return _makeRequest(path, 'PUT', body, true);
  }

  /**
   * Set the HDMI input.
   * @param {Number} input 1 to 4
   */
  async function _setHDMISource(input) {
    if (!_ready) {
      log.error(LOG_PREFIX, `Not ready.`);
      return null;
    }
    const val = honHelpers.isValidInt(input, 1, 4);
    if (val === null) {
      log.error(LOG_PREFIX, 'HDMI input must be between 1 and 4', input);
      throw new Error('Invalid input');
    }
    const path = '/execution';
    const body = {hdmiSource: `input${val}`};
    return _makeRequest(path, 'PUT', body, true);
  }

  /**
   * Set the intensity of the display
   *
   * @param {String} intensity (subtle, moderate, high, intense)
   */
  async function _setIntensity(intensity) {
    if (!_ready) {
      log.error(LOG_PREFIX, `Not ready.`);
      return null;
    }
    if (!ENUM_INTENSITY.includes(intensity) || !intensity) {
      log.error(LOG_PREFIX, 'Invalid intensity value', intensity);
      throw new Error('Invalid input');
    }
    const path = '/execution';
    const body = {intensity: intensity};
    return _makeRequest(path, 'PUT', body, true);
  }

  /**
   * Set the brightness
   *
   * @param {Number} bri 0-200
   */
  async function _setBrightness(bri) {
    if (!_ready) {
      log.error(LOG_PREFIX, `Not ready.`);
      return null;
    }
    const val = honHelpers.isValidInt(bri, 0, 200);
    if (val === null) {
      log.error(LOG_PREFIX, 'Invalid brightness value', bri);
      throw new Error('Invalid input');
    }
    const path = '/execution';
    const body = {brightness: bri};
    return _makeRequest(path, 'PUT', body, true);
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
      agent: _httpAgent,
    };
    if (body) {
      fetchOpts.body = JSON.stringify(body);
      fetchOpts.headers['Content-Type'] = 'application/json';
    }
    log.debug(LOG_PREFIX, `${msg}`, body);
    let resp;
    try {
      resp = await fetch(url, fetchOpts);
    } catch (ex) {
      if (retry) {
        log.verbose(LOG_PREFIX, `${msg} - Request error`, ex);
        await honHelpers.sleep(250);
        return _makeRequest(requestPath, method, body, false);
      }
      log.error(LOG_PREFIX, `${msg} - Request error`, ex);
      throw ex;
    }

    if (!resp.ok) {
      if (retry) {
        log.verbose(LOG_PREFIX, `${msg} - Response error`, resp);
        await honHelpers.sleep(250);
        return _makeRequest(requestPath, method, body, false);
      }
      log.error(LOG_PREFIX, `${msg} - Response error`, resp);
      throw new Error('Response Error');
    }

    let respBody;
    try {
      respBody = await resp.json();
    } catch (ex) {
      if (retry) {
        log.verbose(LOG_PREFIX, `${msg} - JSON error`, ex);
        await honHelpers.sleep(250);
        return _makeRequest(requestPath, method, body, false);
      }
      log.error(LOG_PREFIX, `${msg} - JSON error`, ex);
      throw new Error('JSON Conversion Error');
    }

    const errors = [];
    if (respBody.error) {
      errors.push(respBody);
    } else if (Array.isArray(respBody)) {
      respBody.forEach((item) => {
        if (item.error) {
          errors.push(item);
        }
      });
    }

    if (errors.length === 0) {
      return respBody;
    }

    if (retry) {
      log.verbose(LOG_PREFIX, `${msg} - Body error(s).`, errors);
      await honHelpers.sleep(250);
      return _makeRequest(requestPath, method, body, false);
    }

    log.error(LOG_PREFIX, `${msg} - will retry.`, errors);
    throw new Error('Failed');
  }
}

util.inherits(HueSync, EventEmitter);

module.exports = HueSync;
