'use strict';

var EventEmitter = require('events').EventEmitter;
var log = require('./SystemLog2');
var util = require('util');
var moment = require('moment');
var noble;

var LOG_PREFIX = 'PRESENCE';

function Presence() {

  var AWAY = 'AWAY';
  var PRESENT = 'PRESENT';
  var MAX_AWAY = 60 * 3;
  var self = this;
  var nobleStarted = false;
  var status = {};
  var flicUUID;
  var lastFlics = [];
  var flicPushed = false;
  var numPresent = 0;
  var intervalID;
  var timeFormat = 'YYYY-MM-DDTHH:mm:ss.SSS';

  function emitChange(person) {
    var msg = '[NAME] is [STATE] ([COUNT])';
    msg = msg.replace('[NAME]', person.name);
    msg = msg.replace('[STATE]', person.state);
    msg = msg.replace('[COUNT]', numPresent);
    log.log(LOG_PREFIX, msg);
    self.emit('change', person, numPresent, status);
  }

  function checkAwayTimer() {
    var keys = Object.keys(status);
    var keyLen = keys.length;
    var now = Date.now();
    for (var i = 0; i < keyLen; i++) {
      var person = status[keys[i]];
      if (person.track === true) {
        var timeSinceLastSeen = (now - person.lastSeen) / 1000;
        if ((timeSinceLastSeen > MAX_AWAY) && (person.state === PRESENT)) {
          person.state = AWAY;
          numPresent -= 1;
          emitChange(person);
        }
      }
    }
  }

  function startCheckAwayTimer() {
    log.debug(LOG_PREFIX, 'checkAwayTimer started.');
    if (intervalID) {
      stopCheckAwayTimer();
    }
    intervalID = setInterval(checkAwayTimer, 2000);
  }

  function stopCheckAwayTimer() {
    log.debug(LOG_PREFIX, 'checkAwayTimer stopped.');
    if (intervalID) {
      clearInterval(intervalID);
      intervalID = null;
    }
  }

  function sawFlic(peripheral) {
    var TIMES_FLIC_HIT = 4;
    var now = Date.now();
    lastFlics.unshift(now);
    if (lastFlics[TIMES_FLIC_HIT - 1]) {
      var timeSinceLastFlic = now - lastFlics[TIMES_FLIC_HIT - 1];
      if (timeSinceLastFlic < 250 && flicPushed !== true) {
        flicPushed = true;
        setTimeout(function() {
          flicPushed = false;
        }, 45000);
        var msg = 'Flic Button Pushed: ';
        msg += timeSinceLastFlic + ' ';
        msg += moment(now).format(timeFormat) + ' ';
        msg += lastFlics;
        log.debug(LOG_PREFIX, msg);
        self.emit('flic_away');
      }
    }
    lastFlics = lastFlics.slice(0, TIMES_FLIC_HIT - 1);
  }

  function sawPerson(peripheral) {
    if (flicUUID && peripheral.uuid === flicUUID) {
      sawFlic(peripheral);
      return;
    }
    var person = status[peripheral.uuid];
    if (person && person.track === true) {
      var now = Date.now();
      person.lastSeen = now;
      person.lastSeen_ = moment(now).format(timeFormat);
      if (person.state === AWAY) {
        person.state = PRESENT;
        numPresent += 1;
        emitChange(person);
      }
    }
  }

  function startNoble() {
    noble.on('stateChange', function(state) {
      log.log(LOG_PREFIX, 'Noble State Change: ' + state);
      if (state === 'poweredOn') {
        noble.startScanning([], true);
      } else {
        noble.stopScanning();
        self.emit('adapterError', {'adapterState': state});
        log.exception(LOG_PREFIX, 'Unknown adapter state.', state);
      }
    });
    noble.on('scanStart', function() {
      log.log(LOG_PREFIX, 'Noble Scanning Started.');
      nobleStarted = true;
      self.emit('scanStarted', false);
    });
    noble.on('scanStop', function() {
      log.log(LOG_PREFIX, 'Noble Scanning Stopped.');
      nobleStarted = false;
      self.emit('scanStopped', false);
    });
    noble.on('discover', sawPerson);
    if (nobleStarted === false) {
      noble.startScanning([], true);
    }
  }

  this.setFlicAway = function(uuid) {
    log.log(LOG_PREFIX, 'Set Flic Away UUID: ' + uuid);
    flicUUID = uuid;
  };

  this.addPerson = function(newPerson) {
    try {
      var uuid = newPerson.uuid;
      var person = status[uuid];
      if (person) {
        log.warn(LOG_PREFIX, newPerson.name + ' already exists.');
        return false;
      }
      status[uuid] = newPerson;
      status[uuid].lastSeen = 0;
      status[uuid].state = AWAY;
      log.log(LOG_PREFIX, 'Added: ' + newPerson.name + ' (' + uuid + ')');
      return true;
    } catch (ex) {
      log.exception(LOG_PREFIX, 'Error adding new person.', ex);
      return false;
    }
  };

  // TODO Remove person from status and numPresent! 
  this.removePersonByKey = function(uuid) {
    log.todo(LOG_PREFIX, 'Remove person from status and numPresent! ');
    try {
      var person = status[uuid];
      if (person) {
        log.log(LOG_PREFIX, 'Removed: ' + person.name + ' (' + uuid + ')');
        status[uuid] = null;
        return true;
      }
      log.warn(LOG_PREFIX, 'Could not find ' + uuid + ' to remove.');
      return false;
    } catch (ex) {
      log.exception(LOG_PREFIX, 'Error removing person', ex);
      return false;
    }
  };

  // TODO Remove person from numPresent if track==false
  this.updatePerson = function(uPerson) {
    log.todo(LOG_PREFIX, 'Remove person from numPresent if track==false');
    try {
      var uuid = uPerson.uuid;
      var person = status[uuid];
      if (person) {
        status[uuid].name = uPerson.name;
        status[uuid].track = uPerson.track;
        log.log(LOG_PREFIX, 'Updated: ' + uPerson.name + ' (' + uuid + ')');
        return true;
      }
      log.warn(LOG_PREFIX, 'Could not find ' + uuid + ' to update.');
      return false;
    } catch (ex) {
      log.exception(LOG_PREFIX, 'Error updating person.', ex);
      return false;
    }
  };

  this.shutdown = function() {
    stopCheckAwayTimer();
    if (noble) {
      noble.stopScanning();
    }
    nobleStarted = false;
    log.log(LOG_PREFIX, 'Shut down.');
  };

  function init() {
    log.init(LOG_PREFIX, 'Init');
    try {
      noble = require('noble');
      startNoble();
      startCheckAwayTimer();
    } catch (ex) {
      log.exception(LOG_PREFIX, 'Presence initialization error.', ex);
      setTimeout(function() {
        self.emit('presence_unavailable');
      }, 100);
    }
  }

  init();
}

util.inherits(Presence, EventEmitter);

module.exports = Presence;
