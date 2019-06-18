'use strict';

const util = require('util');
const request = require('request');
const log = require('./SystemLog2');
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
 * @fires Awair#device_found
 * @fires Awair#data_changed
 * @fires Awair#settings_changed
*/
function Awair(token) {
  const _self = this;
  const _authToken = token;
  const BASE_URL = `https://developer-apis.awair.is/v1`;

  const REFRESH_INTERVAL_AIR_DATA = 5 * 60 * 1000;
  const REFRESH_INTERVAL_SETTINGS = 10 * 60 * 1000;

  const DISPLAY_MODES = [
    'score', 'temp', 'humid', 'co2', 'voc', 'pm25', 'clock',
  ];
  const LED_MODES = [
    'auto', 'manual', 'sleep',
  ];

  this.dataStore = {};

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
          if (!devices) {
            log.error(LOG_PREFIX, 'No Awair devices found.');
            return;
          }
          devices.forEach((device) => {
            const deviceType = device.deviceType;
            const deviceId = device.deviceId;
            const key = `${deviceType}/${deviceId}`;
            _self.emit('device_found', key, device);
            device.data = {};
            device.settings = {};
            _self.dataStore[key] = device;
            _monitorAirData(deviceType, deviceId);
            _monitorSettings(deviceType, deviceId);
          });
        })
        .catch((err) => {
          const msg = `Unable to get Awair devices on startup.`;
          log.exception(LOG_PREFIX, msg, err);
        });
  }

  /**
   * Monitors the Air Data for changes, fires data_changed when updated.
   *
   * @param {String} deviceType
   * @param {String} deviceId
   */
  function _monitorAirData(deviceType, deviceId) {
    const key = `${deviceType}/${deviceId}`;
    _getLatestAirData(deviceType, deviceId).then((newVal) => {
      if (!newVal) {
        log.warn(LOG_PREFIX, `No air data avilable for ${key}`);
        return;
      }
      if (diff(_self.dataStore[key].data, newVal)) {
        _self.dataStore[key].data = newVal;
        _self.emit('data_changed', key, newVal);
      }
    }).catch((err) => {
      log.exception(LOG_PREFIX, `Unable to update Air Data for ${key}`, err);
    });
    setTimeout(() => {
      _monitorAirData(deviceType, deviceId);
    }, REFRESH_INTERVAL_AIR_DATA);
  }

  /**
   * Monitors the settings for changes, fires settings_changed when updated.
   *
   * @param {String} deviceType
   * @param {String} deviceId
   */
  function _monitorSettings(deviceType, deviceId) {
    const key = `${deviceType}/${deviceId}`;
    _getSettings(deviceType, deviceId).then((newVal) => {
      let changed = false;
      if (diff(_self.dataStore[key].settings.display, newVal.display)) {
        _self.dataStore[key].settings.display = newVal.display;
        changed = true;
      }
      if (diff(_self.dataStore[key].settings.knocking, newVal.knocking)) {
        _self.dataStore[key].settings.knocking = newVal.knocking;
        changed = true;
      }
      if (diff(_self.dataStore[key].settings.led, newVal.led)) {
        _self.dataStore[key].settings.led = newVal.led;
        changed = true;
      }
      if (diff(_self.dataStore[key].settings.powerStatus, newVal.powerStatus)) {
        _self.dataStore[key].settings.powerStatus = newVal.powerStatus;
        changed = true;
      }
      if (changed) {
        _self.emit('settings_changed', key, _self.dataStore[key].settings);
      }
    }).catch((err) => {
      log.exception(LOG_PREFIX, `Unable to update settings for ${key}`, err);
    });
    setTimeout(() => {
      _monitorSettings(deviceType, deviceId);
    }, REFRESH_INTERVAL_SETTINGS);
  }

  /**
   * Get a list of Devices the User owns.
   *
   * @return {Promise} Array of devices.
   */
  function _getDevices() {
    log.debug(LOG_PREFIX, `getDevices()`);
    const path = `/users/self/devices`;
    return _makeAwairRequest(path).then((devices) => {
      return devices.devices;
    });
  }

  /**
   * Get the latest AirData closest to Current DateTime for the specified
   * Device. If no AirData in the last 10 minutes, it will return null.
   *
   * @param {String} deviceType
   * @param {String} deviceId
   * @return {Promise} Array of sensor data.
   */
  function _getLatestAirData(deviceType, deviceId) {
    log.debug(LOG_PREFIX, `getLatestAirData('${deviceType}', '${deviceId}')`);
    const queryString = `?fahrenheit=false`;
    const path = `/users/self/devices/`
        + `${deviceType}/${deviceId}/`
        + `air-data/latest${queryString}`;
    return _makeAwairRequest(path).then((rawData) => {
      const data = rawData.data[0];
      const result = {
        timeStamp: data.timestamp,
        score: data.score,
        sensors: {},
      };
      data.sensors.forEach((sensor) => {
        const key = sensor.comp;
        result.sensors[key] = {value: sensor.value};
      });
      data.indices.forEach((sensor) => {
        const key = sensor.comp;
        result.sensors[key].score = sensor.value;
      });
      return result;
    });
  }

  /**
   * Get the current settings of the Awair.
   * Settings include: display, knocking, led, and power status.
   *
   * @param {String} deviceType
   * @param {String} deviceId
   * @return {Promise} Object with the settings
   */
  function _getSettings(deviceType, deviceId) {
    log.debug(LOG_PREFIX, `getSettings('${deviceType}', '${deviceId}')`);
    const displayMode = `/devices/${deviceType}/${deviceId}/display`;
    const ledMode = `/devices/${deviceType}/${deviceId}/led`;
    // const knockingMode = `/devices/${deviceType}/${deviceId}/knocking`;
    // const powerStatus = `/devices/${deviceType}/${deviceId}/power-status`;
    const promises = [];
    promises.push(_makeAwairRequest(displayMode));
    promises.push(_makeAwairRequest(ledMode));
    // promises.push(_makeAwairRequest(knockingMode));
    // promises.push(_makeAwairRequest(powerStatus));
    return Promise.all(promises)
        .then((settings) => {
          const results = {};
          if (settings[0] && settings[0].mode) {
            results.display = settings[0].mode;
          }
          if (settings[1]) {
            results.led = settings[1];
          }
          if (settings[2] && settings[2].mode) {
            results.knocking = settings[2].mode;
          }
          if (settings[3]) {
            results.powerStatus = settings[3];
          }
          return results;
        });
  }

  /**
   * Updates the settings for the Awair device
   *
   * @param {String} deviceType
   * @param {String} deviceId
   * @param {Object} settings
   * @param {String} [settings.display]
   * @param {Object} [settings.led]
   * @param {String} [settings.led.mode]
   * @param {Number} [settings.led.brightness]
   * @return {Promise} Array with the result of the settings update.
   */
  this.updateSettings = function(deviceType, deviceId, settings) {
    const msg = `updateSettings('${deviceType}', '${deviceId}', {...})`;
    log.verbose(LOG_PREFIX, msg, settings);
    const promises = [];
    if (settings.hasOwnProperty('display')) {
      const value = settings.display;
      if (DISPLAY_MODES.includes(value)) {
        promises.push(_setDisplay(deviceType, deviceId, value));
      }
    }
    if (settings.hasOwnProperty('led')) {
      const ledMode = settings.led.mode;
      const brightness = settings.led.brightness;
      if (LED_MODES.includes(ledMode)) {
        promises.push(_setLED(deviceType, deviceId, ledMode, brightness));
      }
    }
    return Promise.all(promises);
  };

  /**
   * Gets an Awair device by it's name.
   *
   * @param {String} deviceName
   * @return {Object}
   */
  this.getDeviceKeyByName = function(deviceName) {
    let result = null;
    const keys = Object.keys(_self.dataStore);
    const len = keys.length;
    for (let i = 0; i < len; i++) {
      const key = keys[i];
      const device = _self.dataStore[key];
      if (device.name === deviceName) {
        result = {
          deviceType: device.deviceType,
          deviceId: device.deviceId,
          key: key,
        };
        break;
      }
    }
    return result;
  };

  /**
   *
   * @param {String} deviceType
   * @param {String} deviceId
   * @param {String} mode (score, temp, humid, co2, voc, pm25, clock)
   * @return {Promise}
   */
  function _setDisplay(deviceType, deviceId, mode) {
    const key = `${deviceType}/${deviceId}`;
    const msg = `setDisplay('${deviceType}', '${deviceId}', '${mode}')`;
    log.debug(LOG_PREFIX, msg, mode);
    const path = `/devices/${deviceType}/${deviceId}/display`;
    const body = {mode: mode};
    return _makeAwairRequest(path, 'PUT', body)
        .then((resp) => {
          return _makeAwairRequest(path);
        })
        .then((newVal) => {
          if (diff(_self.dataStore[key].settings.display, newVal.mode)) {
            _self.dataStore[key].settings.display = newVal.mode;
            _self.emit('settings_changed', key, _self.dataStore[key].settings);
          }
          return {display: true};
        })
        .catch((err) => {
          const msg = `Unable to set 'display' for ${key}`;
          log.exception(LOG_PREFIX, msg, err);
          return {display: false};
        });
  }

  /**
   *
   * @param {String} deviceType
   * @param {String} deviceId
   * @param {String} mode (auto, manual, sleep)
   * @param {Number} [brightness]
   * @return {Promise}
   */
  function _setLED(deviceType, deviceId, mode, brightness) {
    const key = `${deviceType}/${deviceId}`;
    const msg = `setLED('${deviceType}', '${deviceId}', `+
        `'${mode}', ${brightness})`;

    const body = {
      mode: mode,
    };
    if (mode === 'manual') {
      brightness = parseInt(brightness);
      if (!isNaN(brightness) && brightness >= 0 && brightness <= 100) {
        body.brightness = brightness;
      }
    }
    log.debug(LOG_PREFIX, msg, body);
    const path = `/devices/${deviceType}/${deviceId}/led`;
    return _makeAwairRequest(path, 'PUT', body)
        .then((resp) => {
          return _makeAwairRequest(path);
        })
        .then((newVal) => {
          if (diff(_self.dataStore[key].settings.led, newVal)) {
            _self.dataStore[key].settings.led = newVal;
            _self.emit('settings_changed', key, _self.dataStore[key].settings);
          }
          return {led: true};
        })
        .catch((err) => {
          const msg = `Unable to set 'led' for ${key}`;
          log.exception(LOG_PREFIX, msg, err);
          return {led: false};
        });
  }

  /**
   * Makes a request to the Awair API.
   *
   * @param {String} requestPath
   * @param {String} [method] HTTP request method to use, default as GET.
   * @param {Object} [body] The body to send.
   * @return {Promise} Object with result of request.
   */
  function _makeAwairRequest(requestPath, method, body) {
    if (!_authToken) {
      log.error(LOG_PREFIX, 'Failed. No auth token provided.');
      return;
    }
    method = method || 'GET';
    const msg = `makeAwairRequest('${method}', '${requestPath}')`;
    log.verbose(LOG_PREFIX, msg, body);
    const requestOpts = {
      url: `${BASE_URL}${requestPath}`,
      method: method,
      json: true,
      auth: {
        bearer: _authToken,
      },
    };
    if (body) {
      requestOpts.body = body;
    }
    return new Promise((resolve, reject) => {
      request(requestOpts, (error, response, respBody) => {
        if (error) {
          log.error(LOG_PREFIX, `${msg} failed`, error);
          return reject(error);
        }
        if (response.statusCode === 200) {
          return resolve(respBody);
        }
        const statusCode = response.statusCode;
        log.error(LOG_PREFIX, `${msg} failed (${statusCode})`, respBody);
        return resolve(null);
      });
    });
  }

  _init();
}

util.inherits(Awair, EventEmitter);

module.exports = Awair;
