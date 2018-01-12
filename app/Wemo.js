'use strict';

const util = require('util');
const log = require('./SystemLog2');
const WemoAPI = require('wemo-client');
const EventEmitter = require('events').EventEmitter;

const LOG_PREFIX = 'WEMO';

/**
 * Wemo API.
 * @constructor
 *
 * @see https://github.com/timonreinhard/wemo-client
 *
 * @fires Wemo#device_found
 * @fires Wemo#change
 * @fires Wemo#error
*/
function Wemo() {
  const _self = this;
  const REFRESH_INTERVAL = 7 * 60 * 1000;
  let wemo;
  const _clients = {};
  const _devices = {};

  /**
   * Init
  */
  function _init() {
    log.init(LOG_PREFIX, 'Starting...');
    wemo = new WemoAPI();
    _searchForDevices();
    setInterval(_searchForDevices, REFRESH_INTERVAL);
  }

  /**
   * Sets the binary state of a switch.
   *
   * @param {String} id The device ID.
   * @param {boolean} state True for on, False for off.
   * @return {Promise} The promise that will be resolved on completion.
   */
  this.setState = function(id, state) {
    const msg = `setState('${id}', ${state})`;
    log.log(LOG_PREFIX, msg);
    return new Promise((resolve, reject) => {
      if (!_isReady()) {
        reject(new Error('not_ready'));
        return;
      }
      const client = _clients[id];
      if (!client) {
        log.error(LOG_PREFIX, `${msg} failed: Device not found.`);
        reject(new Error('device_not_found'));
        return;
      }
      const val = state ? 1 : 0;
      client.setBinaryState(val, (err, resp) => {
        if (err) {
          log.error(LOG_PREFIX, `${msg} failed.`, err);
          reject(err);
          return;
        }
        log.debug(LOG_PREFIX, `${msg} success`, resp);
        resolve(resp);
      });
    });
  };

  /**
   * Gets the binary state of a switch.
   *
   * @param {String} id The device ID.
   * @return {Promise} The promise that will be resolved on completion.
   */
  this.getState = function(id) {
    const msg = `getState('${id}')`;
    log.log(LOG_PREFIX, msg);
    return new Promise((resolve, reject) => {
      if (!_isReady()) {
        reject(new Error('not_ready'));
        return;
      }
      const client = _clients[id];
      if (!client) {
        log.error(LOG_PREFIX, `${msg} failed: Device not found.`);
        reject(new Error('device_not_found'));
        return;
      }
      client.getBinaryState((err, val) => {
        if (err) {
          log.error(LOG_PREFIX, `${msg} failed.`, err);
          reject(err);
          return;
        }
        log.debug(LOG_PREFIX, `${msg} success: ${val}`);
        resolve(val == true);
      });
    });
  };

  /**
   * Manually adds a Wemo device/
   *
   * @param {string} setupURL Must point to setup.xml of the requested device.
   *   eg: http://device_ip:device_port/setup.xml
   * @return {boolean} True if the setup will be completed.
   */
  this.addDevice = function(setupURL) {
    log.log(LOG_PREFIX, `addDevice('${setupURL}')`);
    if (_isReady() === false) {
      return false;
    }
    wemo.load(setupURL, _onWemoDeviceFound);
    return true;
  };

  /**
   * Checks if the Wemo controller is ready.
   *
   * @return {boolean} True if the ready.
   */
  function _isReady() {
    if (wemo) {
      return true;
    }
    log.error(LOG_PREFIX, 'Wemo not ready.');
    return false;
  }

  /**
   * Searches for new Wemo devices.
   *
   * @return {boolean} True if search started.
   */
  function _searchForDevices() {
    log.debug(LOG_PREFIX, '_searchForDevices()');
    if (_isReady() === false) {
      return false;
    }
    wemo.discover(_onWemoDeviceFound);
    return true;
  }

  /**
   * Callback for Wemo device found.
   *
   * @fires Wemo#device_found
   * @fires Wemo#change
   * @fires Wemo#error
   * @param {Error} err Error (if any).
   * @param {Object} deviceInfo Device info.
   */
  function _onWemoDeviceFound(err, deviceInfo) {
    if (err) {
      const msg = 'Error in _onWemoDeviceFound, device NOT added.';
      log.error(LOG_PREFIX, msg, err);
      return;
    }
    const dName = deviceInfo.friendlyName;
    const dMac = deviceInfo.macAddress.toUpperCase();
    const msg = `Wemo ${dName} (${dMac}) found.`;
    log.log(LOG_PREFIX, msg);
    _self.emit('device_found', dMac, deviceInfo);

    const client = wemo.client(deviceInfo);
    _devices[dMac] = deviceInfo;
    _clients[dMac] = client;

    client.on('error', (err) => {
      _self.emit('error', err);
      log.error(LOG_PREFIX, `Error from ${dName}`, err);
    });

    client.on('binaryState', (value) => {
      deviceInfo.value = value;
      _self.emit('change', dMac, deviceInfo);
      const val = value === 1 ? true : false;
      log.log(LOG_PREFIX, `binaryState for ${dName} changed to ${val}`);
    });
  }


  _init();
}

util.inherits(Wemo, EventEmitter);

module.exports = Wemo;
