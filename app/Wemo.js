'use strict';

/* node14_ready */

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
    if (!_isReady()) {
      log.warn(LOG_PREFIX, `${msg} failed, Wemo not ready.`);
      return Promise.reject(new Error('not_ready'));
    }

    const client = _clients[id];
    if (!client) {
      log.error(LOG_PREFIX, `${msg} failed: Device not found.`);
      return Promise.reject(new Error('device_not_found'));
    }

    log.debug(LOG_PREFIX, msg);
    return new Promise((resolve, reject) => {
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
    if (!_isReady()) {
      log.warn(LOG_PREFIX, `${msg} failed, Wemo not ready.`);
      return Promise.reject(new Error('not_ready'));
    }

    const client = _clients[id];
    if (!client) {
      log.error(LOG_PREFIX, `${msg} failed: Device not found.`);
      return Promise.reject(new Error('device_not_found'));
    }

    log.debug(LOG_PREFIX, msg);
    return new Promise((resolve, reject) => {
      client.getBinaryState((err, val) => {
        if (err) {
          log.error(LOG_PREFIX, `${msg} failed.`, err);
          reject(err);
          return;
        }
        log.debug(LOG_PREFIX, `${msg} success: ${val}`);
        resolve(val === true);
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
    const msg = `addDevice('${setupURL}')`;
    if (!_isReady()) {
      log.warn(LOG_PREFIX, `${msg} failed, Wemo not ready.`);
      return false;
    }
    log.debug(LOG_PREFIX, msg);
    wemo.load(setupURL, _onWemoDeviceFound);
    return true;
  };

  /**
   * Checks if the Wemo controller is ready.
   *
   * @return {boolean} True if the ready.
   */
  function _isReady() {
    return wemo ? true : false;
  }

  /**
   * Searches for new Wemo devices.
   *
   * @return {boolean} True if search started.
   */
  function _searchForDevices() {
    log.verbose(LOG_PREFIX, '_searchForDevices()');
    if (!_isReady()) {
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
    if (_devices[dMac]) {
      log.warn(LOG_PREFIX, `${msg} Already exists, will replace.`, deviceInfo);
      _devices[dMac] = null;
      _clients[dMac] = null;
    }
    log.debug(LOG_PREFIX, msg, deviceInfo);
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
      log.verbose(LOG_PREFIX, `binaryState for ${dName} changed to ${value}`);
    });

    client.on('statusChange', (deviceId, capabilityId, value) => {
      const details = {
        device: {
          name: dName,
          mac: dMac,
        },
        deviceId: deviceId,
        capabilityId: capabilityId,
        value: value,
      };
      const msg = `Status of '${deviceId}' changed to '${value}'`;
      log.log(LOG_PREFIX, msg, details);
    });

    client.on('attributeList', (name, value, prevVal, timestamp) => {
      const details = {
        device: {
          name: dName,
          mac: dMac,
        },
        name: name,
        value: value,
        prevValue: prevVal,
        timestamp: timestamp,
      };
      const msg = `Attribute '${name}' changed to '${value}' was '${prevVal}'`;
      log.log(LOG_PREFIX, msg, details);
    });
  }


  _init();
}

util.inherits(Wemo, EventEmitter);

module.exports = Wemo;
