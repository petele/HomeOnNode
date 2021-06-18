'use strict';

const util = require('util');
const log = require('./SystemLog2');
const EventEmitter = require('events').EventEmitter;

const LOG_PREFIX = 'BEDJET';

/**
 * BedJet API
 *
 * * SvcX:  00001000-bed0-0080-aa55-4265644a6574
 *  * Char: 00002000-bed0-0080-aa55-4265644a6574
 *      Byte 01: Unknown
 *      Byte 02: Unknown
 *      Byte 03: Unknown
 *      Byte 04: Unknown
 *      Byte 05: Hours Remaining
 *      Byte 06: Minutes Remaining
 *      Byte 07: Seconds Remaining
 *      Byte 08: Temperature (Actual)
 *      Byte 09: Temperature (Set Point)
 *      Byte 10: Mode [01-05]
 *      Byte 11: Fan Speed [13=100%]
 *      Byte 12: Unknown
 *      Byte 13: Unknown
 *      Byte 14: Unknown
 *      Byte 15: Unknown
 *      Byte 16: Unknown
 *      Byte 17: Unknown
 *      Byte 18: Unknown
 *      Byte 19: Unknown
 *      Byte 20: Unknown
 *  * Char: 00002004-bed0-0080-aa55-4265644a6574
 *      0x01 0x01 - off
 *      0x01 0x20 - m1
 *      0x01 0x21 - m2
 *      0x01 0x22 - m3
 * @constructor
 *
 * @param {String} address Bluetooth address
 * @param {Object} bt Bluetooth object
*/
function BedJet(address, bt) {
  let _address;
  let _bedJet;
  const _bluetooth = bt;
  const _self = this;

  /**
   * Init the BedJet Connection
  */
  function _init() {
    log.init(LOG_PREFIX, 'Starting...');
    if (!_bluetooth) {
      log.error(LOG_PREFIX, 'Bluetooth not available.');
      return;
    }
    if (!address) {
      log.error(LOG_PREFIX, `No address provided.`);
      return;
    }
    _address = address.toLowerCase();

    _bluetooth.on('discover', (peripheral) => {
      const uuid = peripheral.uuid.toLowerCase();
      if (uuid !== _address) {
        // Not the bedJet, abort...
        return;
      }
      if (_bedJet) {
        // Already found a BedJet, skipping...
        return;
      }
      _foundBedJet(peripheral);
    });
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
      log.error(LOG_PREFIX, `isReady() failed: peripheral not provided/found.`);
      return false;
    }
    return true;
  }

  /**
   * Connects to the BedJet
   *
   * @fires BedJet#found
   *
   * @param {Peripheral} bedJet BedJet peripheral
   */
  function _foundBedJet(bedJet) {
    _bedJet = bedJet;
    const uuid = bedJet.uuid;
    const deviceName = bedJet.advertisement.localName;
    const address = bedJet.address;
    const details = {uuid, deviceName, address};
    const msg = `Found ${deviceName}`;
    log.log(LOG_PREFIX, msg, details);
    _bluetooth.watch(bedJet);
    _self.emit('found', details);
  }

  /**
   * Turns the BedJet off.
   *
   * @return {Boolean} If request was successful.
   */
  this.off = async function() {
    try {
      log.log(LOG_PREFIX, `Turning off BedJet`);
      await _setBasicValue([0x01, 0x01]); // send 0101
      return true;
    } catch (ex) {
      log.exception(LOG_PREFIX, `Attempt to turn off BedJet failed.`, ex);
    }
    return false;
  };

  /**
   * Start a pre-programmed mode.
   *
   * @param {Number} val Memory value (1-3)
   * @return {Boolean} If the request was successful
   */
  this.startMemory = async function(val) {
    try {
      val = parseInt(val, 10);
      if (val < 1 || val > 3 || isNaN(val)) {
        log.error(LOG_PREFIX, `Invalid memory setting, should be 1-3`, val);
        return false;
      }
      // const cmd = `012${id}`; // send 012(id-1);
      const arr = [0x01, 0x1F + val];
      log.log(LOG_PREFIX, `Starting memory 'M${val}'`);
      await _setBasicValue(arr);
      return true;
    } catch (ex) {
      log.exception(LOG_PREFIX, `Failed to start memory 'M${val}' failed.`, ex);
    }
    return false;
  };

  /**
   * Send a basic command
   *
   * @param {Array} arr Value to send
   * @return {Promise} A completed promise when the task finishes
   */
  function _setBasicValue(arr) {
    const msg = `setBasicValue(${arr})`;
    const svcUUID = '00001000bed00080aa554265644a6574';
    const charUUID = '00002004bed00080aa554265644a6574';
    log.debug(LOG_PREFIX, msg, {svcUUID, charUUID, val: arr});
    if (_isReady(_bedJet) === false) {
      return Promise.reject(new Error('not_ready'));
    }
    const buff = Buffer.from(arr);
    return _bluetooth.setValue(_bedJet, svcUUID, charUUID, buff, true);
  }

  _init();
}
util.inherits(BedJet, EventEmitter);

module.exports = BedJet;
