'use strict';

const util = require('util');
const log = require('./SystemLog2');
// const Wemo = require('wemo-client');
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

  /**
   * Init
  */
  function _init() {
    log.init(LOG_PREFIX, 'Starting...');
    // wemo = new Wemo();
    // _searchForDevices();
    // setInterval(_searchForDevices, REFRESH_INTERVAL);
  }

  /**
   * Execute a Wemo command
   *
   * @param {Object} command The command to run.
   * @param {String} modifier Any modifiers to change the command.
   * @return {Promise} The promise that will be resolved on completion.
   */
  this.executeCommand = function(command, modifier) {
    // return new Promise((resolve, reject) => {
    //   if (!_isReady()) {
    //     reject(new Error('not_ready'));
    //     return;
    //   }
    //   resolve('not_yet_implemented');
    // });
  };

  /**
   * Manually adds a Wemo device/
   *
   * @param {string} setupURL Must point to setup.xml of the requested device.
   *   eg: http://device_ip:device_port/setup.xml
   * @return {boolean} True if the setup will be completed.
   */
  this.addDevice = function(setupURL) {
    // if (_isReady() === false) {
    //   return false;
    // }
    // wemo.load(setupURL, _onWemoDeviceFound);
    // return true;
  }

  /**
   * Checks if the Wemo controller is ready.
   *
   * @return {boolean} True if the ready.
   */
  function _isReady() {
    // if (wemo) {
    //   return true;
    // }
    // log.error(LOG_PREFIX, 'Wemo not ready.');
    // return false;
  }

  /**
   * Searches for new Wemo devices.
   */
  function _searchForDevices() {
    // log.debug(LOG_PREFIX, '_searchForDevices');
    // if (_isReady() === false) {
    //   return false;
    // }
    // wemo.discover(_onWemoDeviceFound);
  }

  /**
   * Callback for Wemo device found.
   *
   * @param {Error} err Error (if any).
   * @param {Object} deviceInfo Device info.
   */
  function _onWemoDeviceFound(err, deviceInfo) {
    // log.log(LOG_PREFIX, `Wemo device found: ${deviceInfo}`)
    // const client = wemo.client(deviceInfo);
    // client.on('error', (err) => {
    //   log.warning(LOG_PREFIX, 'Error', err);
    // });
    // client.on('binaryState', (value) => {
    //   log.log(LOG_PREFIX, `binaryState: ${value}`);
    // });
  }


  _init();
}

util.inherits(Wemo, EventEmitter);

module.exports = Wemo;
