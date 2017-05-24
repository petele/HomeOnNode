'use strict';

const EventEmitter = require('events').EventEmitter;
const log = require('./SystemLog2');
const util = require('util');
const moment = require('moment');

const LOG_PREFIX = 'PRESENCE';

/**
 * Presence and Bluetooth API
*/
function Presence() {
  const USER_STATES = {
    AWAY: 'AWAY',
    PRESENT: 'PRESENT',
  };
  const TIME_FORMAT = 'YYYY-MM-DDTHH:mm:ss.SSS';
  const MAX_AWAY = 3 * 60 * 1000;
  const _self = this;
  let _noble;
  let _nobleStarted = false;
  let _status = {};
  let _flicUUID;
  let _lastFlics = [];
  let _flicPushed = false;
  let _numPresent = 0;

  /**
   * Sets the UUID for the Flic for Away button
   *
   * @param {String} uuid
  */
  this.setFlicAwayUUID = function(uuid) {
    log.log(LOG_PREFIX, 'Set Flic Away UUID: ' + uuid);
    _flicUUID = uuid;
  };

  /**
   * Adds a new person to track
   *
   * @param {Object} newPerson
   * @return {Boolean} True is the person was successfully added.
  */
  this.addPerson = function(newPerson) {
    try {
      const uuid = newPerson.uuid;
      let person = _status[uuid];
      if (person) {
        log.warn(LOG_PREFIX, newPerson.name + ' already exists.');
        return false;
      }
      _status[uuid] = newPerson;
      _status[uuid].lastSeen = 0;
      _status[uuid].state = USER_STATES.AWAY;
      log.log(LOG_PREFIX, `Added: ${newPerson.name} (${uuid})`);
      return true;
    } catch (ex) {
      log.exception(LOG_PREFIX, 'Error adding new person.', ex);
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
    try {
      let person = _status[uuid];
      if (person) {
        log.log(LOG_PREFIX, `Removed: ${person.name} (${uuid})`);
        if (person.state === USER_STATES.PRESENT) {
          _numPresent -= 1;
        }
        delete _status[uuid];
        return true;
      }
      log.warn(LOG_PREFIX, 'Could not find ' + uuid + ' to remove.');
      return false;
    } catch (ex) {
      log.exception(LOG_PREFIX, 'Error removing person', ex);
      return false;
    }
  };

  /**
   * Updates a person in the tracking list.
   *
   * @param {Object} uPerson The person object to update.
   * @return {Boolean} True is the person was successfully updated.
  */
  this.updatePersonByKey = function(uPerson) {
    try {
      const uuid = uPerson.uuid;
      let person = _status[uuid];
      if (person) {
        person.name = uPerson.name;
        person.track = uPerson.track;
        if (uPerson.track === false && person.state === USER_STATES.PRESENT) {
          _numPresent -= 1;
          person.state = USER_STATES.AWAY;
        }
        log.log(LOG_PREFIX, `Updated: ${person.name} (${uuid})`);
        return true;
      }
      log.warn(LOG_PREFIX, 'Could not find ' + uuid + ' to update.');
      return false;
    } catch (ex) {
      log.exception(LOG_PREFIX, 'Error updating person.', ex);
      return false;
    }
  };

  /**
   * Shut down the Bluetooth services
  */
  this.shutdown = function() {
    if (_noble) {
      _noble.stopScanning();
    }
    _nobleStarted = false;
    log.log(LOG_PREFIX, 'Shut down.');
  };

  /**
   * Init the service
  */
  function _init() {
    log.init(LOG_PREFIX, 'Init');
    try {
      _noble = require('noble');
      _startNoble();
      setInterval(_awayTimerTick, 15 * 1000);
    } catch (ex) {
      log.exception(LOG_PREFIX, 'Presence initialization error.', ex);
    }
  }

  /**
   * Start the Noble service
  */
  function _startNoble() {
    _noble.on('stateChange', function(state) {
      log.log(LOG_PREFIX, 'Noble State Change: ' + state);
      if (state === 'poweredOn') {
        _noble.startScanning([], true);
      } else {
        _noble.stopScanning();
        _self.emit('adapter_error', {'adapterState': state});
        log.exception(LOG_PREFIX, 'Unknown adapter state.', state);
      }
    });
    _noble.on('scanStart', function() {
      log.log(LOG_PREFIX, 'Noble Scanning Started.');
      _nobleStarted = true;
      _self.emit('scan_started');
    });
    _noble.on('scanStop', function() {
      log.log(LOG_PREFIX, 'Noble Scanning Stopped.');
      _nobleStarted = false;
      _self.emit('scan_stopped');
    });
    _noble.on('discover', sawPerson);
    if (_nobleStarted === false) {
      _noble.startScanning([], true);
    }
  }

  /**
   * Handles a Noble event when a 'person' was last seen
   *
   * @param {Object} peripheral The peripheral object of the BLE device
  */
  function sawPerson(peripheral) {
    if (peripheral.uuid === _flicUUID) {
      _sawFlic(peripheral);
      return;
    }
    let person = _status[peripheral.uuid];
    if (person && person.track === true) {
      const now = Date.now();
      person.lastSeen = now;
      person.lastSeen_ = moment(now).format(TIME_FORMAT);
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
    log.log(LOG_PREFIX, `${person.name} is ${person.state} (${_numPresent})`);
    _self.emit('change', person, _numPresent, _status);
  }

  /**
   * Timer Tick to update the present/away status of user
  */
  function _awayTimerTick() {
    if (_nobleStarted !== true) {
      return;
    }
    const now = Date.now();
    Object.keys(_status).forEach((key) => {
      let person = _status[key];
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

  /**
   * Register a Flic button press
   *
   * @fires Presence#flic_away
   *
   * @param {Object} peripheral The Flick peripheral object
  */
  function _sawFlic(peripheral) {
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
        msg += timeSinceLastFlic + ' ';
        msg += moment(now).format(TIME_FORMAT);
        log.debug(LOG_PREFIX, msg);
        _self.emit('flic_away');
      }
    }
    _lastFlics = _lastFlics.slice(0, TIMES_FLIC_HIT - 1);
  }

  _init();
}

util.inherits(Presence, EventEmitter);

module.exports = Presence;
