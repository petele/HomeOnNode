'use strict';

const util = require('util');
const log = require('./SystemLog2');
const EventEmitter = require('events').EventEmitter;

const LOG_PREFIX = 'FLIC';

/**
 * Flic API
 * @constructor
 *
 * @fires FlicMonitor#flic_pushed
 * @param {Object} bt Bluetooth object.
 * @param {Number} hitTimeout Reset time (in ms) between hits.
*/
function FlicMonitor(bt, hitTimeout) {
  const TIMES_FLIC_HIT = 4;
  const HIT_TIMEOUT = 45 * 1000;
  const _self = this;
  const _bluetooth = bt;
  const _hitTimeout = hitTimeout || HIT_TIMEOUT;
  let _flicButtons = {};

  /**
   * Init the Flic monitor
  */
  function _init() {
    log.init(LOG_PREFIX, 'Starting...');
    if (!_bluetooth) {
      log.error(LOG_PREFIX, 'Bluetooth not available.');
      return;
    }
    _bluetooth.on('discover', (peripheral) => {
      const flic = _flicButtons[peripheral.uuid];
      if (flic) {
        _sawFlic(flic, peripheral);
      }
    });
  }

  /**
   * Add a Flic button to the watch list
   *
   * @param {String} uuid
  */
  this.add = function(uuid) {
    log.debug(LOG_PREFIX, `add('${uuid}')`);
    const flic = {
      uuid: uuid,
      lastFlics: [],
      flicPushed: false,
    };
    _flicButtons[uuid] = flic;
  };

  /**
   * Remove a Flic button from the watch list
   *
   * @param {String} uuid
  */
  this.remove = function(uuid) {
    log.debug(LOG_PREFIX, `remove('${uuid}')`);
    if (_flicButtons[uuid]) {
      _flicButtons[uuid] = null;
    }
  };

  /**
   * Register a Flic button press
   *
   * @fires Presence#flic_pushed
   *
   * @param {Object} flic The interal Flic object
   * @param {Object} peripheral The Flic peripheral object
  */
  function _sawFlic(flic, peripheral) {
    const now = Date.now();
    flic.lastFlics.unshift(now);
    if (flic.lastFlics[TIMES_FLIC_HIT - 1]) {
      const timeSinceLastFlic = now - flic.lastFlics[TIMES_FLIC_HIT - 1];
      if (timeSinceLastFlic < 250 && flic.flicPushed !== true) {
        flic.flicPushed = true;
        setTimeout(function() {
          flic.flicPushed = false;
        }, _hitTimeout);
        const extra = {
          flic: flic,
          address: peripheral.address,
          rssi: peripheral.rssi,
          name: peripheral.advertisement.localName,
        };
        log.log(LOG_PREFIX, `flicPushed('${flic.uuid}')`, extra);
        _self.emit('flic_pushed', flic.uuid);
      }
    }
    flic.lastFlics = flic.lastFlics.slice(0, TIMES_FLIC_HIT - 1);
  }

  _init();
}
util.inherits(FlicMonitor, EventEmitter);

module.exports = FlicMonitor;
