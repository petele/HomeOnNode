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
 * @fires Wemo#change
*/
function Wemo() {
  const _self = this;
  const REFRESH_INTERVAL = 7 * 60 * 1000;
  let wemo;
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
   * Execute a Wemo command
   *
   * @param {Object} command The command to run.
   * @param {String} modifier Any modifiers to change the command.
   * @return {Promise} The promise that will be resolved on completion.
   */
  this.executeCommand = function(command, modifier) {
    log.log(LOG_PREFIX, `executeCommand(${command}, ${modifier})`);
    return new Promise((resolve, reject) => {
      if (!_isReady()) {
        reject(new Error('not_ready'));
        return;
      }
      let client = _devices[command.id];
      if (!client) {
        reject(new Error('device_not_found'));
        return;
      }
      let val = command.value ? 1 : 0;
      if (modifier === 'OFF') {
        val = 0;
      }
      client.setBinaryState(val, (err, resp) => {
        if (err) {
          reject(err);
          return;
        }
        log.debug(LOG_PREFIX, `Response: ${resp}`);
        resolve(resp);
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
   * @param {Error} err Error (if any).
   * @param {Object} deviceInfo Device info.
   */
  function _onWemoDeviceFound(err, deviceInfo) {
    const dType = deviceInfo.deviceType;
    const dName = deviceInfo.friendlyName;
    const dID = deviceInfo.deviceId;
    const msg = `Wemo ${dName} (${dType}) found. [${dID}]`;
    log.log(LOG_PREFIX, msg);
    const client = wemo.client(deviceInfo);
    client.on('error', (err) => {
      _self.emit('error', err);
      log.warning(LOG_PREFIX, `Error from ${dName} (${dID})`, err);
    });
    client.on('binaryState', (value) => {
      deviceInfo.value = value;
      _self.emit('change', deviceInfo);
      log.log(LOG_PREFIX, `${dID} binaryState: ${value}`);
    });
    const deviceId = deviceInfo.deviceId;
    _devices[deviceId] = client;
  }


  _init();
}

util.inherits(Wemo, EventEmitter);

module.exports = Wemo;
