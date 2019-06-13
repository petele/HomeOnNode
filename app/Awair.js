'use strict';

const util = require('util');
const log = require('./SystemLog2');
const fetch = require('node-fetch');
const diff = require('deep-diff').diff;
const EventEmitter = require('events').EventEmitter;

const LOG_PREFIX = 'AWAIR';

/**
 * Awair API.
 * @constructor
 *
 * @see https://docs.developer.getawair.com/?version=latest
 *
 * @param {String} token Authentication token.
 * @fires Awair#change
 * @fires Awair#error
*/
function Awair(token) {
  const _self = this;
  const _authToken = token;
  const BASE_URL = `https://developer-apis.awair.is`;

  const REFRESH_INTERVAL_DEVICES = 60 * 60 * 1000;
  const REFRESH_INTERVAL_AIR_DATA = 5 * 60 * 1000;
  const REFRESH_INTERVAL_SETTINGS = 10 * 60 * 1000;

  this.dataStore = {
    devices: null,
    airData: null,
    displayMode: null,
    knockingMode: null,
    ledMode: null,
    powerStatus: null,
    timeZone: null,
  };

  /**
   * Init
   */
  function _init() {
    log.init(LOG_PREFIX, 'Starting...');
    if (!_authToken) {
      log.error(LOG_PREFIX, 'Failed. No auth token provided.');
      return;
    }
    _getDevices()
        .then((devices) => {
          _self.emit(`ready`);
        });
    _startMonitor();
  }

  /**
   * Starts the monitor.
   */
  function _startMonitor() {
    setInterval(() => {
      _getDevices();
    }, REFRESH_INTERVAL_DEVICES);
    setInterval(() => {
      _getLatestAirData();
    }, REFRESH_INTERVAL_AIR_DATA);
    setInterval(() => {
      // Get settings
    }, REFRESH_INTERVAL_SETTINGS);
  }

  /**
   * Get a list of Devices the User owns.
   *
   * @return {Promise} Array of devices.
   */
  function _getDevices() {
    const path = '/v1/users/self/devices';
    return _makeAwairRequest(path)
        .then((newVal) => {
          if (diff(_self.dataStore.devices, newVal)) {
            _self.dataStore.devices = newVal.devices;
            _self.emit(`devices`, newVal.devices);
          }
          return newVal.devices;
        });
  }

  /**
   * Get the latest AirData closest to Current DateTime for the specified
   * Device. If no AirData in the last 10 minutes, it will return null.
   *
   * @return {Promise} Array of sensor data.
   */
  function _getLatestAirData() {
    const queryString = `?fahrenheit=false`;
    const path = `/v1/users/self/devices/awair/0/air-data/latest${queryString}`;
    return _makeAwairRequest(path)
        .then((newVal) => {
          if (diff(_self.dataStore.airData, newVal)) {
            _self.dataStore.airData = newVal.data;
            _self.emit(`air-data`, newVal.data);
          }
        });
  }

  /**
   * Makes a request to the Awair API.
   *
   * @param {String} requestPath
   * @param {String} [method] HTTP request method to use, default as GET.
   * @return {Promise} Object with result of request.
   */
  function _makeAwairRequest(requestPath, method) {
    if (!_authToken) {
      log.error(LOG_PREFIX, 'Failed. No auth token provided.');
      return;
    }
    method = method || 'GET';
    const msg = `makeAwairRequest('${method}', '${requestPath}')`;
    log.verbose(LOG_PREFIX, msg);
    const url = `${BASE_URL}`;
    const opts = {
      method: method,
      headers: {
        'Authorization': _authToken,
      },
    };
    return fetch(url, opts)
        .then((res) => {
          log.debug(res);
          return res.json();
        });
  }


  _init();
}

util.inherits(Awair, EventEmitter);

module.exports = Awair;
