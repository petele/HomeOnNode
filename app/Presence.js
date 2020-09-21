'use strict';

const util = require('util');
const log = require('./SystemLog2');
const FBHelper = require('./FBHelper');
const EventEmitter = require('events').EventEmitter;

const LOG_PREFIX = 'PRESENCE';

/**
 * Presence API
 * @constructor
 *
 * @fires Presence#change
 * @param {Object} bt Bluetooth object
 * @param {Object} people Inital list of people to watch
*/
function Presence(bt, people) {
  const USER_STATES = {
    AWAY: 'AWAY',
    PRESENT: 'PRESENT',
  };
  const MAX_AWAY = 3 * 60 * 1000;
  const AWAY_REFRESH_INTERVAL = 15 * 1000;
  const _bluetooth = bt;
  const _self = this;
  const _people = {};
  let _numPresent = 0;

  /**
   * Init the Presence monitor
  */
  function _init() {
    log.init(LOG_PREFIX, 'Starting...');
    if (!_bluetooth) {
      log.error(LOG_PREFIX, 'Bluetooth not available.');
      return;
    }
    if (people) {
      const uuids = Object.keys(people);
      uuids.forEach((uuid) => {
        const person = people[uuid];
        _addPerson(uuid, person);
      });
    }
    _bluetooth.on('discover', (peripheral) => {
      const uuid = peripheral.uuid.toLowerCase();
      const person = _people[uuid];
      if (person) {
        _sawPerson(person, peripheral);
      }
    });
    _initFirebase();
    setInterval(_awayTimerTick, AWAY_REFRESH_INTERVAL);
  }

  /**
   *
   */
  async function _initFirebase() {
    const fbRootRef = await FBHelper.getRootRefUnlimited();
    const fbPeopleRef = await fbRootRef.child('config/HomeOnNode/presence');

    fbPeopleRef.on('child_added', (snapshot) => {
      const uuid = snapshot.key;
      const person = snapshot.val();
      _addPerson(uuid, person);
    });
    fbPeopleRef.on('child_removed', (snapshot) => {
      const uuid = snapshot.key;
      _removePerson(uuid);
    });
    fbPeopleRef.on('child_changed', (snapshot) => {
      const uuid = snapshot.key;
      const person = snapshot.val();
      _updatePerson(uuid, person);
    });
  }

  /**
   * Adds a new person to track
   *
   * @param {String} uuid The UUID of the person to track
   * @param {Object} person The person object to add
  */
  function _addPerson(uuid, person) {
    uuid = uuid.toLowerCase();
    if (_people[uuid]) {
      return;
    }
    const msg = `add('${uuid}')`;
    person.lastSeen = 0;
    person.state = USER_STATES.AWAY;
    _people[uuid] = person;
    log.debug(LOG_PREFIX, msg, person);
    _emitChange(person);
  }

  /**
   * Removes a person from the tracking list
   *
   * @param {String} uuid The UUID of the person to remove
  */
  function _removePerson(uuid) {
    uuid = uuid.toLowerCase();
    const msg = `remove('${uuid}')`;
    const person = _people[uuid];
    if (!person) {
      log.warn(LOG_PREFIX, msg + ' failed, person does not exist.');
      return;
    }
    if (person.state = USER_STATES.PRESENT) {
      _numPresent -= 1;
      person.state = USER_STATES.AWAY;
    }
    _emitChange(person);
    _people[uuid] = null;
  }

  /**
   * Updates a person in the tracking list.
   *
   * @param {Object} uuid The UUID of the person to update
   * @param {Object} newInfo The info to update.
  */
  function _updatePerson(uuid, newInfo) {
    uuid = uuid.toLowerCase();
    const msg = `update('${uuid}')`;
    const person = _people[uuid];
    if (!person) {
      log.warn(LOG_PREFIX, msg + ' failed, person does not exist.');
      return;
    }
    person.name = newInfo.name;
    person.track = newInfo.track;
    if (person.track === false && person.state === USER_STATES.PRESENT) {
      _numPresent =- 1;
      person.state = USER_STATES.AWAY;
    }
    _emitChange(person);
    log.debug(LOG_PREFIX, msg, person);
  }

  /**
   * Handles a Noble event when a 'person' was last seen
   *
   * @param {Object} person The interal person object
   * @param {Object} peripheral The peripheral object of the BLE device
  */
  function _sawPerson(person, peripheral) {
    const now = Date.now();
    person.lastSeen = now;
    person.lastSeen_ = log.formatTime(now);
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
    log.debug(LOG_PREFIX, `${person.name} is ${person.state}`, person);
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
      const person = _people[key];
      if (!person) {
        return;
      }
      if (!person.track || person.state === USER_STATES.AWAY) {
        return;
      }
      const timeSinceLastSeen = (now - person.lastSeen);
      if (timeSinceLastSeen > MAX_AWAY) {
        person.state = USER_STATES.AWAY;
        _numPresent -= 1;
        _emitChange(person);
      }
    });
  }

  _init();
}
util.inherits(Presence, EventEmitter);

module.exports = Presence;
