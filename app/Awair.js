'use strict';

/* node14_ready */

const util = require('util');
const log = require('./SystemLog2');
const fetch = require('node-fetch');
const FBHelper = require('./FBHelper');
const EventEmitter = require('events').EventEmitter;

const LOG_PREFIX = 'AWAIR';

/**
 * Awair API.
 * @constructor
 *
 * @see https://docs.google.com/document/d/1001C-ro_ig7aEyz0GiWUiiJn0M6DLj47BYWj31acesg/edit
 *
 * @fires Awair#sensors_changed
*/
function Awair() {
  const _self = this;
  const REFRESH_INTERVAL_LOCAL_SENSORS = 1 * 60 * 1000;

  this.localSensors = {};

  /**
   * Init
   */
  async function _init() {
    const fbAwairPath = 'config/HomeOnNode/awair/devices';
    const fbRootRef = await FBHelper.getRootRefUnlimited();
    const fbAwairRef = await fbRootRef.child(fbAwairPath);
    await fbAwairRef.on('child_added', (snapshot) => {
      const deviceId = snapshot.key;
      const ipAddress = snapshot.val();
      log.debug(LOG_PREFIX, `Found Awair device at ${ipAddress}`);
      _monitorLocalDevice(deviceId, ipAddress);
    });
  }

  /**
   * Monitors the local sensors for changes, fires sensor_changed when updated.
   *
   * @param {String} deviceId
   * @param {String} ipAddress
   */
  async function _monitorLocalDevice(deviceId, ipAddress) {
    const msg = `monitorLocalDevice('${deviceId}', '${ipAddress}')`;
    const path = `http://${ipAddress}/air-data/latest`;
    try {
      log.debug(LOG_PREFIX, msg);
      const resp = await fetch(path);
      const newVal = await resp.json();
      log.verbose(LOG_PREFIX, `${msg} - updated`, newVal);
      _self.emit('sensors_changed', deviceId, newVal);
    } catch (ex) {
      log.exception(LOG_PREFIX, `${msg} - failed`, ex);
    }
    setTimeout(() => {
      _monitorLocalDevice(deviceId, ipAddress);
    }, REFRESH_INTERVAL_LOCAL_SENSORS);
  }

  _init();
}

util.inherits(Awair, EventEmitter);

module.exports = Awair;
