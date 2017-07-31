'use strict';

const EventEmitter = require('events').EventEmitter;
const log = require('./SystemLog2');
const util = require('util');

const LOG_PREFIX = 'SOMA_SS';
const BATTERY_SERVICE = {
  uuid: '180f',
  characteristic: '2a19',
};
/**
 * Reference - https://bitbucket.org/jeremynoel476/smartblinds-diy/src
 *
 * motor service uuid:   00001861-B87F-490C-92CB-11BA5EA5167C
 * motor state val char: 00001525-B87F-490C-92CB-11BA5EA5167C
 * - returns an array, the first value is the motor position in percentage
 * motor state control char: 00001530-B87F-490C-92CB-11BA5EA5167C
 * - write 0x69 to move up, 0x96 to move down
 * motor state value char: 00001526-B87F-490C-92CB-11BA5EA5167C
 * - write 0x00 - 0x69, (0 - 100 represented as % in base10)
 */
const MOTOR_SERVICE = {
  uuid: '00001861b87f490c92cb11ba5ea5167c',
  characteristic: {
    current: '00001525b87f490c92cb11ba5ea5167c',
    direction: '00001530b87f490c92cb11ba5ea5167c',
    target: '00001526b87f490c92cb11ba5ea5167c',
  },
};
/**
 * device settings uuid: 00001890-b87f-490c-92cb-11ba5ea5167c
 * device name char: 00001892-b87f-490c-92cb-11ba5ea5167c
 * - must be ascii, 15 bytes in length
 * room name char: 00001893-b87f-490c-92cb-11ba5ea5167c
 * - must be ascii, 15 bytes in length
 */
const DEVICE_SETTINGS = {
  uuid: '00001890b87f490c92cb11ba5ea5167c',
  characteristic: {
    name: '00001892b87f490c92cb11ba5ea5167c',
    room: '00001893b87f490c92cb11ba5ea5167c',
  },
};

/**
 * SOMA Smart Shades API
 * @constructor
 *
 * @param {Object} bt Bluetooth object
 * @param {Object} idToUUID Object that maps IDs to UUIDs
 */
function SomaSmartShades(bt, idToUUID) {
  const _bluetooth = bt;
  const _self = this;
  const ID_TO_UUID = idToUUID;
  const UPDATE_REFRESH_INTERVAL = 30 * 60 * 1000;
  let _uuidToId = {};
  let _somaDevices = {};

  /**
   * Init the SOMA Smart Shades API
   */
  function _init() {
    log.init(LOG_PREFIX, 'Starting...');
    if (!_bluetooth) {
      log.error(LOG_PREFIX, 'Bluetooth not available.');
      return;
    }
    Object.keys(ID_TO_UUID).forEach((id) => {
      const uuid = ID_TO_UUID[id];
      _uuidToId[uuid] = id;
    });
    _bluetooth.on('discover', (peripheral) => {
      const uuid = peripheral.uuid;
      const deviceName = peripheral.advertisement.localName;
      let deviceId = _uuidToId[uuid];
      if (!deviceId) {
        // Not in the list of devices we want to track
        return;
      }
      if (_somaDevices[deviceId]) {
        // We're already tracking this device
        return;
      }
      if (deviceName.indexOf('RISE') !== 0) {
        // This device doesn't start with RISE
        return;
      }
      const btAddress = peripheral.address;
      _somaDevices[deviceId] = peripheral;
      const msg = `Found ${deviceName} (${deviceId})`;
      const addr = `${btAddress} with UUID: ${uuid}`;
      log.log(LOG_PREFIX, msg + ' at ' + addr);
      _bluetooth.watch(peripheral);
      _updateDevice(deviceId, peripheral);
    });
    setInterval(_updateTick, UPDATE_REFRESH_INTERVAL);
  }

  /**
   * Checks if everything is ready
   *
   * @param {Object} peripheral The peripheral that should be ready.
   * @return {Boolean} If everything is ready to go.
   */
  function _isReady(peripheral) {
    if (!_bluetooth) {
      log.error(LOG_PREFIX, `isReady() failed: bluetooth not available.`);
      return false;
    }
    if (_bluetooth.ready !== true) {
      log.error(LOG_PREFIX, `isReady() failed: bluetooth not ready.`);
      return false;
    }
    if (!peripheral) {
      log.error(LOG_PREFIX, `isReady() failed: peripheral not provided.`);
      return false;
    }
    return true;
  }

  /**
   * Updates the details for a SOMA Smart Shade
   *
   * @param {String} deviceId The local device id (BR_L) to use.
   * @return {Promise} A completed promise when the task finishes
   */
  function _updateDevice(deviceId) {
    return _self.getBattery(deviceId)
      .then((batt) => {
        _self.emit('battery', deviceId, batt);
        return _self.getPosition(deviceId, true);
      })
      .then((pos) => {
        _self.emit('level', deviceId, pos);
      })
      .catch(() => {
        // Do nothing, errors have already been reported.
      });
  }

  /**
   * Checks the status for all of the blinds
   *
   * @fires SomaSmartShade#battery.
   * @fires SomaSmartShade#level.
   */
  function _updateTick() {
    if (_isReady(true) === false) {
      return;
    }
    Object.keys(_somaDevices).forEach((deviceId) => {
      _updateDevice(deviceId);
    });
  }

  /**
   * Reads the current battery charge level
   *
   * @param {String} id The local device id (BR_L) to use to.
   * @param {Boolean} [atomic] Should the API disconnect once done.
   * @return {Promise} The battery level of the device.
   */
  this.getBattery = function(id, atomic) {
    const msg = `getBattery('${id}', ${!!atomic})`;
    const peripheral = _somaDevices[id];
    const svcUUID = BATTERY_SERVICE.uuid;
    const charUUID = BATTERY_SERVICE.characteristic;
    log.verbose(LOG_PREFIX, msg);
    if (_isReady(peripheral) === false) {
      return Promise.reject(new Error('not_ready'));
    }
    return _bluetooth.getValue(peripheral, svcUUID, charUUID, atomic)
      .then((buf) => {
        const val = parseInt(buf.readInt8(0), 10);
        log.debug(LOG_PREFIX, `${msg}: ${val}`);
        return val;
      });
  };

  /**
   * Opens the blinds completely.
   *
   * @param {String} id The local device id (BR_L) to use to.
   * @param {Boolean} [atomic] Should the API disconnect once done.
   * @return {Promise} The result of opening the blinds.
   */
  this.open = function(id, atomic) {
    const msg = `open('${id}', ${!!atomic})`;
    const peripheral = _somaDevices[id];
    const svcUUID = MOTOR_SERVICE.uuid;
    const charUUID = MOTOR_SERVICE.characteristic.direction;
    const val = Buffer.from([0x69]);
    log.log(LOG_PREFIX, msg);
    if (_isReady(peripheral) === false) {
      return Promise.reject(new Error('not_ready'));
    }
    return _bluetooth.setValue(peripheral, svcUUID, charUUID, val, atomic)
      .then(() => {
        _self.emit('level', id, 0);
        return 0;
      });
  };

  /**
   * Closes the blinds completely.
   *
   * @param {String} id The local device id (BR_L) to use to.
   * @param {Boolean} [atomic] Should the API disconnect once done.
   * @return {Promise} The result of closing the blinds.
   */
  this.close = function(id, atomic) {
    const msg = `close('${id}', ${!!atomic})`;
    const peripheral = _somaDevices[id];
    const svcUUID = MOTOR_SERVICE.uuid;
    const charUUID = MOTOR_SERVICE.characteristic.direction;
    const val = Buffer.from([0x96]);
    log.log(LOG_PREFIX, msg);
    if (_isReady(peripheral) === false) {
      return Promise.reject(new Error('not_ready'));
    }
    return _bluetooth.setValue(peripheral, svcUUID, charUUID, val, atomic)
      .then(() => {
        _self.emit('level', id, 100);
        return 100;
      });
  };

  /**
   * Toggles the blinds to the opposite position.
   *
   * @param {String} id The local device id (BR_L) to use to.
   * @param {Boolean} [atomic] Should the API disconnect once done.
   * @return {Promise} The result of opening the blinds.
   */
  this.toggle = function(id, atomic) {
    const msg = `toggle('${id}', ${!!atomic})`;
    const peripheral = _somaDevices[id];
    log.log(LOG_PREFIX, msg);
    if (_isReady(peripheral) === false) {
      return Promise.reject(new Error('not_ready'));
    }
    return _self.getPosition(id, false)
      .then((pos) => {
        if (pos === 100) {
          return _self.open(id, atomic);
        }
        if (pos === 0) {
          return _self.close(id, atomic);
        }
        if (pos > 50) {
          return _self.close(id, atomic);
        }
        return _self.open(id, atomic);
      });
  };

  /**
   * Reads the current position of the blinds
   *
   * @param {String} id The local device id (BR_L) to use to.
   * @param {Boolean} [atomic] Should the API disconnect once done.
   * @return {Promise} The position of the device.
   */
  this.getPosition = function(id, atomic) {
    const msg = `getPosition('${id}', ${!!atomic})`;
    const peripheral = _somaDevices[id];
    const svcUUID = MOTOR_SERVICE.uuid;
    const charUUID = MOTOR_SERVICE.characteristic.current;
    log.verbose(LOG_PREFIX, msg);
    if (_isReady(peripheral) === false) {
      return Promise.reject(new Error('not_ready'));
    }
    return _bluetooth.getValue(peripheral, svcUUID, charUUID, atomic)
      .then((buf) => {
        const val = parseInt(buf.readUInt8(0), 10);
        log.debug(LOG_PREFIX, `${msg}: ${val}`);
        return val;
      });
  };

  /**
   * Sets the position of the blinds to a specific point.
   *
   * @param {String} id The local device id (BR_L) to use to.
   * @param {Number} level The percentage CLOSED, from 0 to 100.
   * @param {Boolean} [atomic] Should the API disconnect once done.
   * @return {Promise} The result of the action.
   */
  this.setPosition = function(id, level, atomic) {
    const msg = `setPosition('${id}', ${level}, ${!!atomic})`;
    const peripheral = _somaDevices[id];
    const svcUUID = MOTOR_SERVICE.uuid;
    const charUUID = MOTOR_SERVICE.characteristic.target;
    log.log(LOG_PREFIX, msg);
    if (_isReady(peripheral) === false) {
      return Promise.reject(new Error('not_ready'));
    }
    const iLevel = parseInt(level, 10);
    if (isNaN(iLevel) === true) {
      log.error(LOG_PREFIX, `${msg}: failed: level is not a number.`);
      return Promise.reject(new Error('not_a_number'));
    }
    if (iLevel < 0 || iLevel > 100) {
      log.error(LOG_PREFIX, `${msg}: failed: level is out of range.`);
      return Promise.reject(new RangeError('out_of_range'));
    }
    const val = Buffer.from([iLevel]);
    return _bluetooth.setValue(peripheral, svcUUID, charUUID, val, atomic)
      .then(() => {
        _self.emit('level', id, iLevel);
        return iLevel;
      });
  };

  /**
   * Sets the name of the blinds.
   *
   * @param {String} id The local device id (BR_L) to use to.
   * @param {String} name The name of the blinds.
   * @param {Boolean} [atomic] Should the API disconnect once done.
   * @return {Promise} The result of the action.
   */
  this.setName = function(id, name, atomic) {
    const msg = `setName('${id}', '${name}', ${!!atomic})`;
    log.log(LOG_PREFIX, msg);
    if (!name || name.length > 15 || name.length < 4) {
      log.error(LOG_PREFIX, `${msg} failed: invalid name`);
      return Promise.reject(new Error('invalid_name'));
    }
    const peripheral = _somaDevices[id];
    if (_isReady(peripheral) === false) {
      return Promise.reject(new Error('not_ready'));
    }
    const paddedName = (name + '                        ').substr(0, 15);
    const bufName = Buffer.from(paddedName);
    const svcUUID = DEVICE_SETTINGS.uuid;
    const nameUUID = DEVICE_SETTINGS.characteristic.name;
    return _bluetooth.setValue(peripheral, svcUUID, nameUUID, bufName, atomic);
  };

  /**
   * Sets the room for the blinds.
   *
   * @param {String} id The local device id (BR_L) to use to.
   * @param {String} room The room the blinds are in.
   * @param {Boolean} [atomic] Should the API disconnect once done.
   * @return {Promise} The result of the action.
   */
  this.setRoom = function(id, room, atomic) {
    const msg = `setRoom('${id}', '${room}', ${!!atomic})`;
    log.log(LOG_PREFIX, msg);
    if (!room || room.length > 15 || room.length < 4) {
      log.error(LOG_PREFIX, `${msg} failed: invalid room`);
      return Promise.reject(new Error('invalid_room'));
    }
    const peripheral = _somaDevices[id];
    if (_isReady(peripheral) === false) {
      return Promise.reject(new Error('not_ready'));
    }
    const paddedRoom = (room + '                        ').substr(0, 15);
    const bufRoom = Buffer.from(paddedRoom);
    const svcUUID = DEVICE_SETTINGS.uuid;
    const roomUUID = DEVICE_SETTINGS.characteristic.room;
    return _bluetooth.setValue(peripheral, svcUUID, roomUUID, bufRoom, atomic);
  };

  _init();
}
util.inherits(SomaSmartShades, EventEmitter);

module.exports = SomaSmartShades;
