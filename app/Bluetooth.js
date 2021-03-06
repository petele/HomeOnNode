'use strict';

const util = require('util');
const log = require('./SystemLog2');
const EventEmitter = require('events').EventEmitter;

const LOG_PREFIX = 'BLUETOOTH';

const READ_TIMEOUT = 5000;
const WRITE_TIMEOUT = 5000;
const CONNECT_TIMEOUT = 5000;
const SCAN_TIMEOUT = 90000;

/**
 * Bluetooth API
 * @constructor
 * @property {String} adapterState - Current adapter state.
 * @property {Boolean} ready - Is the bluetooth API ready.
 * @property {Boolean} scanning - Is it currently scanning.
 */
function Bluetooth() {
  const MAX_CONNECTIONS = 5;
  const _self = this;
  this.adapterState = 'uninitialized';
  this.ready = false;
  this.scanning = false;
  let _noble;
  const _connectedDevices = {};
  let _connectedDeviceCount = 0;
  let _scanTimeout;

  /**
   * Init the service
   */
  function _init() {
    log.init(LOG_PREFIX, 'Starting...');
    try {
      _noble = require('@abandonware/noble');
    } catch (ex) {
      log.exception(LOG_PREFIX, 'Noble initialization error.', ex);
      _self.adapterState = 'not_found';
      _self.emit('adapter_state', 'not_found');
      return;
    }
    _noble.on('stateChange', function(state) {
      _self.adapterState = state;
      log.debug(LOG_PREFIX, 'State Change: ' + state);
      if (state === 'poweredOn') {
        _self.ready = true;
        _self.startScanning();
      } else {
        _self.ready = false;
        _self.stopScanning();
        log.error(LOG_PREFIX, `Unknown adapter state: ${state}`);
      }
      _self.emit('adapter_state', state);
    });
    _noble.on('scanStart', function() {
      _self.scanning = true;
      if (_scanTimeout) {
        clearTimeout(_scanTimeout);
        _scanTimeout = null;
      }
      log.debug(LOG_PREFIX, 'Scanning started.');
      _self.emit('scanning', true);
    });
    _noble.on('scanStop', function() {
      _self.scanning = false;
      log.debug(LOG_PREFIX, 'Scanning stopped.');
      if (_scanTimeout) {
        clearTimeout(_scanTimeout);
        _scanTimeout = null;
      }
      _scanTimeout = setTimeout(_restartScan, SCAN_TIMEOUT);
      _self.emit('scanning', false);
    });
    _noble.on('warning', (message) => {
      log.debug(LOG_PREFIX, 'Noble warning', message);
    });
    _noble.on('discover', (peripheral) => {
      _self.emit('discover', peripheral);
    });
  }

  /**
   * Get a single service and characteristic from a peripheral
   *
   * @param {Object} peripheral The Noble peripheral device to use.
   * @param {String} svcUUID The UUID of the service to query.
   * @param {String} charUUID The UUID of the characteristic to query.
   * @return {Promise} Object that contains the service & characterstic.
   */
  function _getServiceAndCharacteristic(peripheral, svcUUID, charUUID) {
    return new Promise(function(resolve, reject) {
      const uuid = peripheral.uuid;
      const msg = `getSvcAndChar('${uuid}', '${svcUUID}', '${charUUID}')`;
      log.verbose(LOG_PREFIX, msg);
      const timeout = setTimeout(() => {
        log.error(LOG_PREFIX, `${msg} failed - timeout exceeded.`);
        reject(new Error('read_timeout_exceeded'));
      }, READ_TIMEOUT);
      peripheral.discoverSomeServicesAndCharacteristics([svcUUID], [charUUID],
          (err, s, c) => {
            clearTimeout(timeout);
            if (err) {
              log.error(LOG_PREFIX, `${msg} failed`, err);
              reject(err);
              return;
            }
            if (!s || s.length !== 1 || !c || c.length !== 1) {
              const result = {svc: s, char: c};
              log.error(LOG_PREFIX, `${msg} failed: bad return.`, result);
              reject(new Error('service_or_char_not_found'));
              return;
            }
            resolve({service: s[0], characteristic: c[0]});
          });
    });
  }

  /**
   * Reads the specified characteristic
   *
   * @param {Object} characteristic The characteristic to read.
   * @return {Promise} Data read from the characteristic.
   */
  function _readCharacteristic(characteristic) {
    return new Promise(function(resolve, reject) {
      const msg = `_readCharacteristic('${characteristic.uuid}')`;
      log.verbose(LOG_PREFIX, msg);
      const timeout = setTimeout(() => {
        log.error(LOG_PREFIX, `${msg} failed - timeout exceeded.`);
        reject(new Error('read_timeout_exceeded'));
      }, READ_TIMEOUT);
      characteristic.read((err, data) => {
        clearTimeout(timeout);
        if (err) {
          log.error(LOG_PREFIX, `${msg} failed`, err);
          reject(err);
          return;
        }
        resolve(data);
      });
    });
  }

  /**
   * Writes a value to the specified characteristic
   *
   * @param {Object} characteristic The characteristic to write.
   * @param {*} value The value to write.
   * @return {Promise} Result of the write attempt.
   */
  function _writeCharacteristic(characteristic, value) {
    return new Promise(function(resolve, reject) {
      const v = JSON.stringify(value.toJSON());
      const msg = `writeChar('${characteristic.uuid}', ${v})`;
      log.verbose(LOG_PREFIX, msg);
      const timeout = setTimeout(() => {
        log.error(LOG_PREFIX, `${msg} failed - timeout exceeded.`);
        reject(new Error('write_timeout_exceeded'));
      }, WRITE_TIMEOUT);
      characteristic.write(value, false, (err) => {
        clearTimeout(timeout);
        if (err) {
          log.error(LOG_PREFIX, `${msg} failed`, err);
          reject(err);
          return;
        }
        resolve(value);
      });
    });
  }

  /**
   * Restarts the scan
   */
  function _restartScan() {
    _scanTimeout = null;
    log.warn(LOG_PREFIX, 'Scan shutdown timeout exceeded.', _connectedDevices);
    _self.startScanning();
  }

  /**
   * Attempts to reset the Bluetooth adapter.
   *
   * @return {Promise<Object>} Result of the reset
   */
  this.resetAdapter = function() {
    log.debug(LOG_PREFIX, `Resetting Bluetooth adapter...`);
    try {
      _noble.reset();
      log.debug(LOG_PREFIX, `Bluetooth adapter reset successfully.`);
      return Promise.resolve({success: true});
    } catch (ex) {
      log.debug(LOG_PREFIX, `Bluetooth adapter reset failed.`, ex);
      return Promise.reject(ex);
    }
  };

  /**
   * Starts Noble scanning
   */
  this.startScanning = function() {
    log.debug(LOG_PREFIX, 'startScanning()');
    if (_self.scanning === true) {
      log.debug(LOG_PREFIX, 'startScanning - already scanning.');
      return;
    }
    if (_connectedDeviceCount > 0) {
      log.debug(LOG_PREFIX, 'startScanning - failed, connected to devices.');
      return;
    }
    _noble.startScanning([], true);
  };

  /**
   * Stops Noble scanning
   */
  this.stopScanning = function() {
    log.debug(LOG_PREFIX, 'stopScanning()');
    if (_self.scanning === false) {
      log.debug(LOG_PREFIX, 'stopScanning - already stopped.');
      return;
    }
    _noble.stopScanning();
  };

  /**
   * Watches the connection state for a specific peripheral
   *
   * @param {Object} peripheral The Noble peripheral to watch.
   */
  this.watch = function(peripheral) {
    const uuid = peripheral?.uuid;
    const msg = `watch('${uuid}')`;
    if (!peripheral || !uuid) {
      log.error(LOG_PREFIX, `${msg} failed: no peripheral provided.`);
      return;
    }
    log.debug(LOG_PREFIX, msg, peripheral);
    _connectedDevices[uuid] = false;
    peripheral.on('connect', (err) => {
      if (err) {
        log.error(LOG_PREFIX, `Error on connection.`, err);
        return;
      }
      _connectedDevices[uuid] = true;
      _connectedDeviceCount += 1;
      log.verbose(LOG_PREFIX, `connected to '${uuid}'`);
      _self.emit('device_connected', uuid);
    });
    peripheral.on('disconnect', (err) => {
      if (err) {
        log.error(LOG_PREFIX, `Error on disconnect.`, err);
        return;
      }
      _connectedDevices[uuid] = false;
      _connectedDeviceCount -= 1;
      log.verbose(LOG_PREFIX, `disconnected from '${uuid}'`);
      if (_connectedDeviceCount === 0) {
        _self.startScanning();
      }
      _self.emit('device_disconnected', uuid);
    });
    const deviceInfo = {
      uuid: uuid,
      connected: false,
      address: peripheral.address,
      addressType: peripheral.addressType || 'unknown',
      connectable: peripheral.connectable,
      localName: peripheral.advertisement?.localName || 'undefined',
      txPowerLevel: peripheral.advertisement?.txPowerLevel || 0,
      rssi: peripheral.rssi || 'unavailable',
    };
    _self.emit('device_found', deviceInfo);
  };

  /**
   * Connects to a peripheral
   *
   * @param {Object} peripheral The Noble peripheral to use.
   * @return {Promise} Result of the connection attempt.
   */
  this.connect = function(peripheral) {
    return new Promise(function(resolve, reject) {
      const uuid = peripheral.uuid;
      const msg = `connect('${uuid}')`;
      if (_connectedDevices.hasOwnProperty(uuid) === false) {
        log.warn(LOG_PREFIX, `${msg} warning: not watched.`, _connectedDevices);
        _self.watch(peripheral);
      }
      if (_connectedDeviceCount > MAX_CONNECTIONS) {
        log.error(LOG_PREFIX, `${msg} failed: connection count exceeded.`);
        reject(new Error('connection_count_exceeded'));
        return;
      }
      if (_connectedDevices[uuid] === true) {
        log.verbose(LOG_PREFIX, `${msg} - already connected.`);
        resolve();
        return;
      }
      _self.stopScanning();
      log.verbose(LOG_PREFIX, msg);
      const timeout = setTimeout(() => {
        try {
          peripheral.cancelConnect();
        } catch (ex) {
          log.debug(LOG_PREFIX, `${msg} - cancel connect failed!`, ex);
        }
        log.error(LOG_PREFIX, `${msg} - failed, timeout.`);
        reject(new Error('connect_timeout_exceeded'));
      }, CONNECT_TIMEOUT);
      peripheral.connect((err) => {
        clearTimeout(timeout);
        if (err) {
          log.error(LOG_PREFIX, `${msg} failed: on connect`, err);
          _self.startScanning();
          reject(err);
          return;
        }
        resolve();
      });
    });
  };

  /**
   * Disconnects from a peripheral
   *
   * @param {Object} peripheral The Noble peripheral to use.
   * @return {Promise} Result of the disconnection attempt.
   */
  this.disconnect = function(peripheral) {
    return new Promise(function(resolve, reject) {
      const uuid = peripheral.uuid;
      const msg = `disconnect('${uuid}')`;
      if (_connectedDevices.hasOwnProperty(uuid) === false) {
        log.error(LOG_PREFIX, `${msg} failed: not watched.`, _connectedDevices);
        reject(new Error('not_watched'));
        return;
      }
      if (_connectedDevices[uuid] === false) {
        log.verbose(LOG_PREFIX, `${msg} - not currently connected.`);
        resolve();
        return;
      }
      log.verbose(LOG_PREFIX, msg);
      peripheral.disconnect((err) => {
        if (err) {
          log.error(LOG_PREFIX, `${msg} failed: on disconnect`, err);
          reject(err);
          return;
        }
        resolve();
      });
    });
  };

  /**
   * Gets/reads the value of the specified service & characteristic
   *
   * @param {Object} peripheral The peripheral to read from.
   * @param {String} svcUUID The service UUID to read from.
   * @param {String} charUUID The characteristic UUID to read from.
   * @param {Boolean} [atomic] Read the value then disconnect from peripheral.
   * @return {Promise} Data read from the characteristic.
   */
  this.getValue = function(peripheral, svcUUID, charUUID, atomic) {
    return _self.connect(peripheral)
        .then(() => {
          return _getServiceAndCharacteristic(peripheral, svcUUID, charUUID);
        })
        .then((svcAndChar) => {
          return _readCharacteristic(svcAndChar.characteristic);
        })
        .then((val) => {
          if (atomic === true) {
            _self.disconnect(peripheral);
          }
          return val;
        });
  };

  /**
   * Sets/writes the value to a specific characteristic
   *
   * @param {Object} peripheral The peripheral to set.
   * @param {String} svcUUID The service UUID to read from.
   * @param {String} charUUID The characteristic UUID to read from.
   * @param {*} value The value to write.
   * @param {Boolean} [atomic] Write the value then disconnect from peripheral.
   * @return {Promise} Result of the write attempt.
   */
  this.setValue = function(peripheral, svcUUID, charUUID, value, atomic) {
    return _self.connect(peripheral)
        .then(() => {
          return _getServiceAndCharacteristic(peripheral, svcUUID, charUUID);
        })
        .then((svcAndChar) => {
          const characteristic = svcAndChar.characteristic;
          return _writeCharacteristic(characteristic, value);
        })
        .then((val) => {
          if (atomic === true) {
            _self.disconnect(peripheral);
          }
          return val;
        });
  };

  _init();
}
util.inherits(Bluetooth, EventEmitter);

module.exports = Bluetooth;
