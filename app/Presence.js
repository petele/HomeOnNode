'use strict';

const util = require('util');
const log = require('./SystemLog2');
const EventEmitter = require('events').EventEmitter;


const LOG_PREFIX = 'PRESENCE';

/**
 * Presence API
 * @constructor
 *
 * @fires Presence#change
 * @param {Object} bt Bluetooth object
*/
function Presence(bt) {
  const USER_STATES = {
    AWAY: 'AWAY',
    PRESENT: 'PRESENT',
  };
  const MAX_AWAY = 3 * 60 * 1000;
  const AWAY_REFRESH_INTERVAL = 15 * 1000;
  const _bluetooth = bt;
  const _self = this;
  let _people = {};
  let _numPresent = 0;

  /**
   * Init the Flic monitor
  */
  function _init() {
    log.init(LOG_PREFIX, 'Starting...');
    if (!_bluetooth) {
      log.error(LOG_PREFIX, 'Bluetooth not available.');
      return;
    }
    _bluetooth.on('discover', _sawPerson);
    setInterval(_awayTimerTick, AWAY_REFRESH_INTERVAL);
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
    log.log(LOG_PREFIX, `${person.name} is ${person.state}`, person);
    _self.emit('change', person, _numPresent, _people);
  }

  /**
   * Timer Tick to update the present/away status of user
  */
  function _awayTimerTick() {
    if (_bluetooth.scanning !== true) {
      log.debug(LOG_PREFIX, 'awayTimerTick skipped, Bluetooth not scanning.');
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

module.exports = Presence;
