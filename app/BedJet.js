'use strict';

const util = require('util');
const log = require('./SystemLog2');
const honHelpers = require('./HoNHelpers');
const EventEmitter = require('events').EventEmitter;

const LOG_PREFIX = 'BEDJET';

/**
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
 *                00: Off
 *                01: heat
 *                02: turbo
 *                03: ext-heat
 *                04: cool
 *                05: dry
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
 *  * Char: 00002001-BED0-0080-AA55-4265644A6574 (R) -- device name
 *  * Char: 00002002-BED0-0080-AA55-4265644A6574 (R/W) -- unknown
 *  * Char: 00002003-BED0-0080-AA55-4265644A6574 (W) -- unknown
 *  * Char: 00002004-bed0-0080-aa55-4265644a6574 (W) -- Commands
 *      0x01 0x01 - off
 *      0x01 0x02-6 - cool, heat, turbo, dry, ext heat
 *      0x01 0x10-1 - fan up/down
 *      0x01 0x12-3 - temp up/down
 *      0x01 0x20 - m1
 *      0x01 0x21 - m2
 *      0x01 0x22 - m3
 *  * Char: 00002005-BED0-0080-AA55-4265644A6574 (R/W) -- ?version info?
 *  * Char: 00002006-BED0-0080-AA55-4265644A6574 (R/W) -- ?version info?
 */

/**
 * BedJet API
 *
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
   * @param {Boolean} [retry] If the request fails, should it retry
   * @return {Boolean} If request was successful.
   */
  this.off = async function(retry) {
    try {
      log.log(LOG_PREFIX, `Turning off BedJet`);
      await _setBasicValue([0x01, 0x01]);
      return true;
    } catch (ex) {
      log.exception(LOG_PREFIX, `Attempt to turn off BedJet failed.`, ex);
    }
    if (retry) {
      await honHelpers.sleep(7500);
      return _self.off(false);
    }
    return false;
  };

  /**
   * Prewarm the bed using Turbo Heat mode.
   *
   * @param {Boolean} [retry] If the request fails, should it retry
   * @return {Boolean} If request was successful.
   */
  this.preWarm = async function(retry) {
    try {
      log.log(LOG_PREFIX, `Pre-warming bed...`);
      await _setBasicValue([0x01, 0x04]);
      return true;
    } catch (ex) {
      log.exception(LOG_PREFIX, `Attempt to turn on BedJet failed.`, ex);
    }
    if (retry) {
      await honHelpers.sleep(7500);
      return _self.preWarm(false);
    }
    return false;
  };

  /**
   * Start a pre-programmed mode.
   *
   * @param {Number} val Memory value (1-3)
   * @param {Boolean} [retry] If the request fails, should it retry
   * @return {Boolean} If the request was successful
   */
  this.startMemory = async function(val, retry) {
    try {
      val = parseInt(val, 10);
      if (val < 1 || val > 3 || isNaN(val)) {
        log.error(LOG_PREFIX, `Invalid memory setting, should be 1-3`, val);
        return false;
      }
      log.log(LOG_PREFIX, `Starting memory 'M${val}'`);
      await _setBasicValue([0x01, 0x1F + val]);
      return true;
    } catch (ex) {
      log.exception(LOG_PREFIX, `Failed to start memory 'M${val}' failed.`, ex);
    }
    if (retry) {
      await honHelpers.sleep(7500);
      return _self.startMemory(val, false);
    }
    return false;
  };

  /**
   * Gets the info from the primary service.
   *
   * @return {Buffer}
   */
  this.getInfo = function() {
    const msg = `getInfo()`;
    const svcUUID = '00001000bed00080aa554265644a6574';
    const charUUID = '00002000bed00080aa554265644a6574';
    log.log(LOG_PREFIX, msg, {svcUUID, charUUID});
    if (_isReady(_bedJet) === false) {
      return Promise.reject(new Error('not_ready'));
    }
    return _bluetooth.getValue(_bedJet, svcUUID, charUUID, true);
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
