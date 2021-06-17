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
 *      0101 - off
 *      0120 - m1
 *      0121 - m2
 *      0122 - m3
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
   * Connects to the BedJet
   *
   * @fires BedJet#found
   *
   * @param {Peripheral} bedJet BedJet peripheral
   */
  function _foundBedJet(bedJet) {
    _bedJet = bedJet;
    _bedJet.on('connect', () => {});
    _bedJet.on('disconnect', () => {});
    _self.emit('found', {uuid: bedJet.uuid});
  }


  _init();
}
util.inherits(BedJet, EventEmitter);

module.exports = BedJet;
