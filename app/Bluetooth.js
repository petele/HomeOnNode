'use strict';

const EventEmitter = require('events').EventEmitter;
const log = require('./SystemLog2');
const util = require('util');

const _bluetooth = new Bluetooth();

/**
 * Bluetooth API
 * @constructor
 */
function Bluetooth() {
  const _logPrefix = 'BLUETOOTH';
  const _self = this;
  _self.noble;
  _self.started = false;

  /**
   * Init the service
   */
  function _init() {
    log.init(_logPrefix, 'Starting...');
    try {
      _self.noble = require('noble');
    } catch (ex) {
      log.exception(_logPrefix, 'Presence initialization error.', ex);
      return;
    }
    _self.noble.on('stateChange', function(state) {
      log.log(_logPrefix, 'Noble State Change: ' + state);
      if (state === 'poweredOn') {
        _self.noble.startScanning([], true);
      } else {
        _self.noble.stopScanning();
        log.exception(_logPrefix, 'Unknown adapter state.', state);
      }
    });
    _self.noble.on('scanStart', function() {
      _self.started = true;
      _self.emit('scan_started');
    });
    _self.noble.on('scanStop', function() {
      _self.started = false;
      _self.emit('scan_stopped');
    });
    _self.noble.on('warning', (message) => {
      log.warn(_logPrefix, 'Noble warning: ' + message);
    });
    _self.noble.on('discover', (device) => {
      _self.emit('discover', device);
    });
  }

  this.startScanning = function() {
    log.debug(_logPrefix, 'Stanning started.');
    _self.noble.startScanning([], true);
  };

  this.stopScanning = function() {
    log.debug(_logPrefix, 'Stanning stopped.');
    _self.noble.stopScanning();
  };

  _init();
}
util.inherits(Bluetooth, EventEmitter);

/**
 * Flic API
 * @constructor
 *
 * @fires FlicMonitor#flic_away
*/
function FlicMonitor() {
  const _logPrefix = 'FLIC';
  const _self = this;
  let _flicUUID;
  let _lastFlics = [];
  let _flicPushed = false;

  /**
   * Init the Flic monitor
  */
  function _init() {
    log.init(_logPrefix, 'Starting...');
    if (!_bluetooth) {
      log.error(_logPrefix, 'Bluetooth not ready.');
      return;
    }
    _bluetooth.on('discover', (device) => {
      if (_flicUUID && device.uuid === _flicUUID) {
        _sawFlic(device);
      }
    });
  }

  /**
   * Sets the UUID for the Flic for Away button
   *
   * @param {String} uuid
  */
  this.setFlicAwayUUID = function(uuid) {
    log.debug(_logPrefix, `setFlicAwayUUID('${uuid}')`);
    _flicUUID = uuid;
  };

  /**
   * Register a Flic button press
   *
   * @fires Presence#flic_away
   *
   * @param {Object} device The Flick device object
  */
  function _sawFlic(device) {
    const TIMES_FLIC_HIT = 4;
    const now = Date.now();
    _lastFlics.unshift(now);
    if (_lastFlics[TIMES_FLIC_HIT - 1]) {
      const timeSinceLastFlic = now - _lastFlics[TIMES_FLIC_HIT - 1];
      if (timeSinceLastFlic < 250 && _flicPushed !== true) {
        _flicPushed = true;
        setTimeout(function() {
          _flicPushed = false;
        }, 45000);
        let msg = 'Flic Button Pushed: ';
        msg += timeSinceLastFlic + ' ' + log.formatTime(now);
        log.debug(_logPrefix, msg);
        _self.emit('flic_away');
      }
    }
    _lastFlics = _lastFlics.slice(0, TIMES_FLIC_HIT - 1);
  }

  _init();
}
util.inherits(FlicMonitor, EventEmitter);

/**
 * Presence API
 * @constructor
 *
 * @fires Presence#change
*/
function Presence() {
  const _logPrefix = 'PRESENCE';
  const USER_STATES = {
    AWAY: 'AWAY',
    PRESENT: 'PRESENT',
  };
  const MAX_AWAY = 3 * 60 * 1000;
  const _self = this;
  let _people = {};
  let _numPresent = 0;

  /**
   * Init the Flic monitor
  */
  function _init() {
    log.init(_logPrefix, 'Starting...');
    if (!_bluetooth) {
      log.error(_logPrefix, 'Bluetooth not ready.');
      return;
    }
    _bluetooth.on('discover', _sawPerson);
    setInterval(_awayTimerTick, 15 * 1000);
  }

  /**
   * Adds a new person to track
   *
   * @param {Object} newPerson
   * @return {Boolean} True is the person was successfully added.
  */
  this.addPerson = function(newPerson) {
    const msg = `addPerson('${newPerson.name}', '${newPerson.uuid}')`;
    try {
      const uuid = newPerson.uuid;
      let person = _people[uuid];
      if (person) {
        log.warn(_logPrefix, msg + ' already exists.');
        return false;
      }
      _people[uuid] = newPerson;
      _people[uuid].lastSeen = 0;
      _people[uuid].state = USER_STATES.AWAY;
      log.log(_logPrefix, msg);
      return true;
    } catch (ex) {
      log.exception(_logPrefix, msg + ' failed with exception.', ex);
      return false;
    }
  };

  /**
   * Removes a person from the tracking list
   *
   * @param {String} uuid The UUID of the person to remove
   * @return {Boolean} True is the person was successfully removed.
  */
  this.removePersonByKey = function(uuid) {
    const msg = `removePersonByKey('${uuid}')`;
    try {
      let person = _people[uuid];
      if (person) {
        log.log(_logPrefix, msg);
        if (person.state === USER_STATES.PRESENT) {
          _numPresent -= 1;
        }
        delete _people[uuid];
        return true;
      }
      log.warn(_logPrefix, msg + ' UUID not found.');
      return false;
    } catch (ex) {
      log.exception(_logPrefix, msg + ' failed with exception.', ex);
      return false;
    }
  };

  /**
   * Updates a person in the tracking list.
   *
   * @param {Object} uPerson The person object to update.
   * @return {Boolean} True is the person was successfully updated.
  */
  this.updatePerson = function(uPerson) {
    const msg = `updatePerson(${JSON.stringify(uPerson)})`;
    try {
      const uuid = uPerson.uuid;
      let person = _people[uuid];
      if (person) {
        person.name = uPerson.name;
        person.track = uPerson.track;
        if (uPerson.track === false && person.state === USER_STATES.PRESENT) {
          _numPresent -= 1;
          person.state = USER_STATES.AWAY;
        }
        log.log(_logPrefix, msg);
        return true;
      }
      log.warn(_logPrefix, msg + ' - failed. Could not find person.');
      return false;
    } catch (ex) {
      log.exception(_logPrefix, msg + ' - exception occured.', ex);
      return false;
    }
  };

  /**
   * Handles a Noble event when a 'person' was last seen
   *
   * @param {Object} peripheral The peripheral object of the BLE device
  */
  function _sawPerson(peripheral) {
    let person = _people[peripheral.uuid];
    if (person && person.track === true) {
      const now = Date.now();
      person.lastSeen = now;
      person.lastSeenFormatted = log.formatTime(now);
      if (peripheral.rssi) {
        person.rssi = peripheral.rssi;
      }
      if (peripheral.advertisement && peripheral.advertisement.localName) {
        person.localName = peripheral.advertisement.localName;
      }
      if (person.state === USER_STATES.AWAY) {
        person.state = USER_STATES.PRESENT;
        _numPresent += 1;
        _emitChange(person);
      }
    }
  }

  /**
   * Fires an event when a persons AWAY/PRESENT status changes
   *
   * @fires Presence#change
   *
   * @param {Object} person The person who's state has changed.
  */
  function _emitChange(person) {
    log.log(_logPrefix, `${person.name} is ${person.state}`);
    _self.emit('change', person, _numPresent, _people);
  }

  /**
   * Timer Tick to update the present/away status of user
  */
  function _awayTimerTick() {
    if (_bluetooth.started !== true) {
      log.debug(_logPrefix, 'awayTimerTick skipped, Bluetooth not running.');
      return;
    }
    const now = Date.now();
    Object.keys(_people).forEach((key) => {
      let person = _people[key];
      if (person.track === true) {
        const timeSinceLastSeen = (now - person.lastSeen);
        if ((timeSinceLastSeen > MAX_AWAY) &&
            (person.state === USER_STATES.PRESENT)) {
          person.state = USER_STATES.AWAY;
          _numPresent -= 1;
          _emitChange(person);
        }
      }
    });
  }
  _init();
}
util.inherits(Presence, EventEmitter);

/**
 * SOMA Smart Shades API
 * @constructor
 *
 * @param {Object} idToUUID Object that maps IDs to UUIDs
 */
function SomaSmartShades(idToUUID) {
  const _logPrefix = 'SOMA_SS';
  const _self = this;
  const _idToUUID = idToUUID;
  let _uuidToId = {};
  let _somaDevices = {};
  let _somaConnectionStatus = {};
  let _devicesConnected = 0;

  const UPDATE_REFRESH_INTERVAL = 20 * 60 * 1000;
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
   * Init the SOMA Smart Shades API
   */
  function _init() {
    log.init(_logPrefix, 'Starting...');
    if (!_bluetooth) {
      log.error(_logPrefix, 'Bluetooth not ready.');
      return;
    }
    Object.keys(_idToUUID).forEach((id) => {
      const uuid = _idToUUID[id];
      _uuidToId[uuid] = id;
    });
    _bluetooth.on('discover', (peripheral) => {
      const uuid = peripheral.uuid;
      const deviceName = peripheral.advertisement.localName;
      let deviceId = _uuidToId[uuid];
      if (!deviceId) {
        return;
      }
      if (deviceName.indexOf('RISE') !== 0) {
        return;
      }
      if (_somaDevices[deviceId]) {
        return;
      }
      const btAddress = peripheral.address;
      _somaDevices[deviceId] = peripheral;
      _somaConnectionStatus[deviceId] = false;
      const msg = `Found ${deviceName} (${deviceId})`;
      const addr = `${btAddress} with UUID: ${uuid}`;
      log.log(_logPrefix, msg + ' at ' + addr);
      peripheral.on('connect', () => {
        _devicesConnected += 1;
        _somaConnectionStatus[deviceId] = true;
        log.debug(_logPrefix, `Connected to '${deviceId}'.`);
      });
      peripheral.on('disconnect', () => {
        _devicesConnected -= 1;
        _somaConnectionStatus[deviceId] = false;
        log.debug(_logPrefix, `Disconnected from '${deviceId}'.`);
        if (_devicesConnected === 0) {
          _bluetooth.startScanning();
        }
      });
      _updateDevice(deviceId, peripheral);
    });
    setInterval(_updateTick, UPDATE_REFRESH_INTERVAL);
  }

  /**
   * Updates the details for a SOMA Smart Shade
   *
   * @param {String} deviceId The local device id (BR_L) to use.
   * @param {Object} peripheral The Noble peripheral device to use.
   * @return {Promise} A completed promise when the task finishes
   */
  function _updateDevice(deviceId, peripheral) {
    return _connect(deviceId, peripheral)
      .then(() => {
        return _self.getBattery(deviceId).then((val) => {
          _self.emit('battery', deviceId, val);
        });
      })
      .then(() => {
        return _self.getPosition(deviceId).then((val) => {
          _self.emit('level', deviceId, val);
        });
      })
      .then(() => {
        return _disconnect(deviceId, peripheral);
      });
  }


  /**
   * Checks the status for all of the blinds
   *
   * @fires SomaSmartShade#battery.
   * @fires SomaSmartShade#level.
   */
  function _updateTick() {
    Object.keys(_somaDevices).forEach((deviceId) => {
      const peripheral = _getDevice(deviceId);
      _updateDevice(deviceId, peripheral);
    });
  }

  /**
   * Connects to a peripheral
   *
   * @param {String} id The local device id (BR_L) to use.
   * @param {Object} peripheral The Noble peripheral device to use.
   * @return {Promise} Result of the connection attempt.
   */
  function _connect(id, peripheral) {
    if (_somaConnectionStatus[id] === true) {
      return Promise.resolve();
    }
    return new Promise(function(resolve, reject) {
      _bluetooth.stopScanning();
      peripheral.connect((err) => {
        if (err) {
          log.error(_logPrefix, `Unable to connected to '${id}'`, err);
          reject(err);
          return;
        }
        resolve();
      });
    });
  }

  /**
   * Disconnect from a peripheral
   *
   * @param {String} id The local device id (BR_L) to use to.
   * @param {Object} [peripheral] The Noble peripheral device to use.
   * @return {Promise} Result of the disconnection attempt.
   */
  function _disconnect(id, peripheral) {
    if (_somaConnectionStatus[id] !== true) {
      return Promise.resolve();
    }
    if (!peripheral) {
      peripheral = _somaDevices[id];
    }
    return new Promise(function(resolve, reject) {
      peripheral.disconnect((err) => {
        if (err) {
          log.error(_logPrefix, `Unable to disconnected from '${id}'`, err);
          reject(err);
          return;
        }
        resolve();
      });
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
      const msg = `getSvcAndChar(${peripheral.uuid}, ${svcUUID}, ${charUUID})`;
      peripheral.discoverSomeServicesAndCharacteristics([svcUUID], [charUUID],
        (err, s, c) => {
          if (err) {
            log.error(_logPrefix, `${msg} failed`, err);
            reject(err);
            return;
          }
          if (!s || s.length !== 1 || !c || c.length !== 1) {
            const result = {svc: s, char: c};
            log.error(_logPrefix, `${msg} failed: bad return.`, result);
            reject(new Error('service_or_char_not_found'));
            return;
          }
          resolve({service: s[0], characteristic: c[0]});
        }
      );
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
      const msg = `readChar('${characteristic.uuid}')`;
      characteristic.read((err, data) => {
        if (err) {
          log.error(_logPrefix, `${msg} failed`, err);
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
      const msg = `writeChar('${characteristic.uuid}', ${value})`;
      characteristic.write(value, false, (err) => {
        if (err) {
          log.error(_logPrefix, `${msg} failed`, err);
          reject(err);
          return;
        }
        resolve();
      });
    });
  }

  /**
   * Finds the SOMA Smart Shade based on the device ID
   *
   * @param {String} id The local device id (BR_L) to use to.
   * @return {Object|Error} The peripheral or an error if it's not found.
   */
  function _getDevice(id) {
    let peripheral = _somaDevices[id];
    if (!peripheral) {
      log.error(_logPrefix, `Unable to find device with id: '${id}'`);
      return new Error('device_not_found');
    }
    return peripheral;
  }

  /**
   * Gets/reads the value of the specified service & characteristic
   *
   * @param {String} id The local device id (BR_L) to use to.
   * @param {String} svcUUID The service UUID to read from.
   * @param {String} charUUID The characteristic UUID to read from.
   * @return {Promise} Data read from the characteristic.
   */
  function _getValue(id, svcUUID, charUUID) {
    let peripheral = _getDevice(id);
    if (peripheral instanceof Error) {
      return Promise.reject(peripheral);
    }
    return _connect(id, peripheral)
      .then(() => {
        return _getServiceAndCharacteristic(peripheral, svcUUID, charUUID);
      })
      .then((svcAndChar) => {
        return _readCharacteristic(svcAndChar.characteristic);
      });
  }

  /**
   * Sets/writes the value to a specific characteristic
   *
   * @param {String} id The local device id (BR_L) to use to.
   * @param {String} svcUUID The service UUID to read from.
   * @param {String} charUUID The characteristic UUID to read from.
   * @param {*} value The value to write.
   * @return {Promise} Result of the write attempt.
   */
  function _setValue(id, svcUUID, charUUID, value) {
    let peripheral = _getDevice(id);
    if (peripheral instanceof Error) {
      return Promise.reject(peripheral);
    }
    return _connect(id, peripheral)
      .then(() => {
        return _getServiceAndCharacteristic(peripheral, svcUUID, charUUID);
      })
      .then((svcAndChar) => {
        const characteristic = svcAndChar.characteristic;
        return _writeCharacteristic(characteristic, value);
      });
  }

  /**
   * Reads the current battery charge level
   *
   * @param {String} id The local device id (BR_L) to use to.
   * @param {Boolean} [disconnectAfter] Should the API disconnect once done.
   * @return {Promise} The battery level of the device.
   */
  this.getBattery = function(id, disconnectAfter) {
    const svcUUID = BATTERY_SERVICE.uuid;
    const charUUID = BATTERY_SERVICE.characteristic;
    return _getValue(id, svcUUID, charUUID)
      .then((buf) => {
        const val = parseInt(buf.readInt8(0), 10);
        log.debug(_logPrefix, `getBattery('${id}'): ${val}`);
        return val;
      }, () => {})
      .then((val) => {
        if (disconnectAfter === true) {
          _disconnect(id);
        }
        return val;
      });
  };

  /**
   * Reads the current position of the blinds
   *
   * @param {String} id The local device id (BR_L) to use to.
   * @param {Boolean} [disconnectAfter] Should the API disconnect once done.
   * @return {Promise} The position of the device.
   */
  this.getPosition = function(id, disconnectAfter) {
    const svcUUID = MOTOR_SERVICE.uuid;
    const charUUID = MOTOR_SERVICE.characteristic.current;
    return _getValue(id, svcUUID, charUUID)
      .then((buf) => {
        const val = parseInt(buf.readUInt8(0), 10);
        log.debug(_logPrefix, `getPosition('${id}'): ${val}`);
        return val;
      }, () => {})
      .then((val) => {
        if (disconnectAfter === true) {
          _disconnect(id);
        }
        return val;
      });
  };

  /**
   * Opens the blinds completely.
   *
   * @param {String} id The local device id (BR_L) to use to.
   * @param {Boolean} [disconnectAfter] Should the API disconnect once done.
   * @return {Promise} The result of opening the blinds.
   */
  this.open = function(id, disconnectAfter) {
    log.info(_logPrefix, `open('${id}')`);
    const svcUUID = MOTOR_SERVICE.uuid;
    const charUUID = MOTOR_SERVICE.characteristic.direction;
    return _setValue(id, svcUUID, charUUID, Buffer.from([0x69]))
      .then(() => {
        _self.emit('level', id, 0);
        return 0;
      }, () => {})
      .then((val) => {
        if (disconnectAfter === true) {
          _disconnect(id);
        }
        return val;
      });
  };

  /**
   * Closes the blinds completely.
   *
   * @param {String} id The local device id (BR_L) to use to.
   * @param {Boolean} [disconnectAfter] Should the API disconnect once done.
   * @return {Promise} The result of closing the blinds.
   */
  this.close = function(id, disconnectAfter) {
    log.info(_logPrefix, `close('${id}')`);
    const svcUUID = MOTOR_SERVICE.uuid;
    const charUUID = MOTOR_SERVICE.characteristic.direction;
    return _setValue(id, svcUUID, charUUID, Buffer.from([0x96]))
      .then(() => {
        _self.emit('level', id, 100);
        return 100;
      }, () => {})
      .then((val) => {
        if (disconnectAfter === true) {
          _disconnect(id);
        }
        return val;
      });
  };

  /**
   * Sets the position of the blinds to a specific point.
   *
   * @param {String} id The local device id (BR_L) to use to.
   * @param {Number} level The percentage CLOSED, from 0 to 100.
   * @param {Boolean} [disconnectAfter] Should the API disconnect once done.
   * @return {Promise} The result of the action.
   */
  this.setPosition = function(id, level, disconnectAfter) {
    level = parseInt(level, 10);
    log.info(_logPrefix, `setPosition('${id}', ${level})`);
    if (level < 0 || level > 100) {
      return Promise.reject(new Error('out_of_range'));
    }
    const svcUUID = MOTOR_SERVICE.uuid;
    const charUUID = MOTOR_SERVICE.characteristic.target;
    return _setValue(id, svcUUID, charUUID, Buffer.from([level]))
      .then(() => {
        _self.emit('level', id, level);
        return level;
      }, () => {})
      .then((val) => {
        if (disconnectAfter === true) {
          _disconnect(id);
        }
        return val;
      });
  };

  /**
   * Sets the name and room of the blinds.
   *
   * @param {String} id The local device id (BR_L) to use to.
   * @param {String} name The name of the blinds.
   * @param {String} room The room the blinds are in.
   * @param {Boolean} [disconnectAfter] Should the API disconnect once done.
   * @return {Promise} The result of the action.
   */
  this.setNameAndRoom = function(id, name, room, disconnectAfter) {
    if (!name || name.length > 15 || name.length < 4) {
      return Promise.reject(new Error('invalid_name'));
    }
    if (!room || room.length > 15 || room.length < 4) {
      return Promise.reject(new Error('invalid_room'));
    }
    const paddedName = (name + '                        ').substr(0, 15);
    const paddedRoom = (room + '                        ').substr(0, 15);
    const bufName = Buffer.from(paddedName);
    const bufRoom = Buffer.from(paddedRoom);
    const svcUUID = DEVICE_SETTINGS.uuid;
    const nameUUID = DEVICE_SETTINGS.characteristic.name;
    const roomUUID = DEVICE_SETTINGS.characteristic.room;
    return _setValue(id, svcUUID, nameUUID, bufName)
      .then(() => {
        return _setValue(id, svcUUID, roomUUID, bufRoom);
      })
      .catch(() => {})
      .then(() => {
        if (disconnectAfter === true) {
          _disconnect(id);
        }
      });
  };

  _init();
}
util.inherits(SomaSmartShades, EventEmitter);

exports.SomaSmartShades = SomaSmartShades;
exports.Presence = Presence;
exports.FlicMonitor = FlicMonitor;
