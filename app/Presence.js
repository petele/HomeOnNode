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
    _bluetooth.on('discover', (peripheral) => {
      const uuid = peripheral.uuid.toLowerCase();
      let person = _people[uuid];
      if (person) {
        _sawPerson(person, peripheral);
      }
    });
    setInterval(_awayTimerTick, AWAY_REFRESH_INTERVAL);
  }

  /**
   * Adds a new person to track
   *
   * @param {String} uuid The UUID of the person to track
   * @param {Object} person The person object to add
  */
  this.add = function(uuid, person) {
    uuid = uuid.toLowerCase();
    const msg = `add('${uuid}')`;
    person.lastSeen = 0;
    person.state = USER_STATES.AWAY;
    _people[uuid] = person;
    log.log(LOG_PREFIX, msg, person);
  };

  /**
   * Removes a person from the tracking list
   *
   * @param {String} uuid The UUID of the person to remove
  */
  this.remove = function(uuid) {
    uuid = uuid.toLowerCase();
    const msg = `remove('${uuid}')`;
    let person = _people[uuid];
    if (!person) {
      log.warn(LOG_PREFIX, msg + ' failed, person does not exist.');
      return;
    }
    if (person.state = USER_STATES.PRESENT) {
      _numPresent -= 1;
    }
    _people[uuid] = null;
  };

  /**
   * Updates a person in the tracking list.
   *
   * @param {Object} uuid The UUID of the person to update
   * @param {Object} person The info to update.
  */
  this.update = function(uuid, person) {
    uuid = uuid.toLowerCase();
    const msg = `update('${uuid}')`;
    let p = _people[uuid];
    if (!p) {
      log.warn(LOG_PREFIX, msg + ' failed, person does not exist.');
      return;
    }
    p.name = person.name;
    p.track = person.track;
    if (p.track === false && p.state === USER_STATES.PRESENT) {
      _numPresent =- 1;
      p.state = USER_STATES.AWAY;
    }
    log.log(LOG_PREFIX, msg, p);
  };

  /**
   * Handles a Noble event when a 'person' was last seen
   *
   * @param {Object} person The interal person object
   * @param {Object} peripheral The peripheral object of the BLE device
  */
  function _sawPerson(person, peripheral) {
    const now = Date.now();
    person.lastSeen = now;
    person.lastSeenFormatted = log.formatTime(now);
    if (person.track === true && person.state === USER_STATES.AWAY) {
      person.state = USER_STATES.PRESENT;
      _numPresent += 1;
      _emitChange(person);
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
