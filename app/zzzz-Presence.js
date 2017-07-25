'use strict';

const EventEmitter = require('events').EventEmitter;
const log = require('./SystemLog2');
const util = require('util');

const LOG_PREFIX = 'PRESENCE';

/**
 * Presence and Bluetooth API
 * @constructor
 *
 * @fires Presence#change
 * @fires Presence#flic_away
*/
function Presence() {
  const USER_STATES = {
    AWAY: 'AWAY',
    PRESENT: 'PRESENT',
  };
  const MAX_AWAY = 3 * 60 * 1000;
  const _self = this;
  let _noble;
  let _nobleStarted = false;
  let _people = {};
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
    log.debug(LOG_PREFIX, `setFlicAwayUUID('${uuid}')`);
    _flicUUID = uuid;
  };

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
        log.warn(LOG_PREFIX, msg + ' already exists.');
        return false;
      }
      _people[uuid] = newPerson;
      _people[uuid].lastSeen = 0;
      _people[uuid].state = USER_STATES.AWAY;
      log.log(LOG_PREFIX, msg);
      return true;
    } catch (ex) {
      log.exception(LOG_PREFIX, msg + ' failed with exception.', ex);
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
        log.log(LOG_PREFIX, msg);
        if (person.state === USER_STATES.PRESENT) {
          _numPresent -= 1;
        }
        delete _people[uuid];
        return true;
      }
      log.warn(LOG_PREFIX, msg + ' UUID not found.');
      return false;
    } catch (ex) {
      log.exception(LOG_PREFIX, msg + ' failed with exception.', ex);
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
        log.log(LOG_PREFIX, msg);
        return true;
      }
      log.warn(LOG_PREFIX, msg + ' - failed. Could not find person.');
      return false;
    } catch (ex) {
      log.exception(LOG_PREFIX, msg + ' - exception occured.', ex);
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
    log.log(LOG_PREFIX, 'Shut down.');
  };

  /**
   * Init the service
  */
  function _init() {
    log.init(LOG_PREFIX, 'Starting...');
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
        log.exception(LOG_PREFIX, 'Unknown adapter state.', state);
      }
    });
    _noble.on('scanStart', function() {
      log.log(LOG_PREFIX, 'Noble Scanning Started.');
      _nobleStarted = true;
    });
    _noble.on('scanStop', function() {
      log.log(LOG_PREFIX, 'Noble Scanning Stopped.');
      _nobleStarted = false;
    });
    _noble.on('warning', (message) => {
      log.warn(LOG_PREFIX, 'Noble warning: ' + message);
    });
    _noble.on('discover', sawPerson);
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
    log.log(LOG_PREFIX, `${person.name} is ${person.state}`);
    /**
     * Fired when a persons AWAY/PRESENT status changes
     * @event Presence#change
     */
    _self.emit('change', person, _numPresent, _people);
  }

  /**
   * Timer Tick to update the present/away status of user
  */
  function _awayTimerTick() {
    if (_nobleStarted !== true) {
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
        msg += timeSinceLastFlic + ' ' + log.formatTime(now);
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
