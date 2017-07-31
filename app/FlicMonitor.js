'use strict';

const EventEmitter = require('events').EventEmitter;
const log = require('./SystemLog2');
const util = require('util');

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
  let _flicUUID;
  let _lastFlics = [];
  let _flicPushed = false;

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
      if (_flicUUID && peripheral.uuid === _flicUUID) {
        _sawFlic(peripheral);
      }
    });
  }

  /**
   * Sets the UUID for the Flic button
   *
   * @param {String} uuid
  */
  this.setFlicUUID = function(uuid) {
    log.debug(LOG_PREFIX, `setFlicUUID('${uuid}')`);
    _flicUUID = uuid;
  };

  /**
   * Register a Flic button press
   *
   * @fires Presence#flic_pushed
   *
   * @param {Object} peripheral The Flic peripheral object
  */
  function _sawFlic(peripheral) {
    const now = Date.now();
    _lastFlics.unshift(now);
    if (_lastFlics[TIMES_FLIC_HIT - 1]) {
      const timeSinceLastFlic = now - _lastFlics[TIMES_FLIC_HIT - 1];
      if (timeSinceLastFlic < 250 && _flicPushed !== true) {
        _flicPushed = true;
        setTimeout(function() {
          _flicPushed = false;
        }, _hitTimeout);
        log.log(LOG_PREFIX, '_sawFlic(true)');
        _self.emit('flic_pushed');
      }
    }
    _lastFlics = _lastFlics.slice(0, TIMES_FLIC_HIT - 1);
  }

  _init();
}
util.inherits(FlicMonitor, EventEmitter);

module.exports = FlicMonitor;
