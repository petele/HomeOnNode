'use strict';

var EventEmitter = require('events').EventEmitter;
var log = require('./SystemLog');
var util = require('util');
var moment = require('moment');
var noble;

function Presence() {

  var AWAY = 'AWAY';
  var PRESENT = 'PRESENT';
  var MAX_AWAY = 60 * 3;
  var self = this;
  var nobleStarted = false;
  var status = {};
  var flicUUID;
  var lastFlic = 0;
  var flicPushed = false;
  var numPresent = 0;
  var intervalID;
  var timeFormat = 'YYYY-MM-DDTHH:mm:ss.SSS';

  function emitChange(person) {
    var msg = '[PRESENCE] [NAME] is [STATE] ([COUNT])';
    msg = msg.replace('[NAME]', person.name);
    msg = msg.replace('[STATE]', person.state);
    msg = msg.replace('[COUNT]', numPresent);
    log.log(msg);
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
    log.debug('[PRESENCE] checkAwayTimer started.');
    if (intervalID) {
      stopCheckAwayTimer();
    }
    intervalID = setInterval(checkAwayTimer, 2000);
  }

  function stopCheckAwayTimer() {
    log.debug('[PRESENCE] checkAwayTimer stopped.');
    if (intervalID) {
      clearInterval(intervalID);
      intervalID = null;
    }
  }

  function sawFlic(peripheral) {
    var now = Date.now();
    var timeSinceLastFlic = Math.abs(now - lastFlic);
    if (timeSinceLastFlic < 100 && lastFlic !== 0 && !flicPushed) {
      flicPushed = true;
      setTimeout(function() {
        log.debug('[PRESENCE] flicPushed: ' + flicPushed + ' reset');
        flicPushed = false;
      }, 60000);
      log.log('[PRESENCE] Flic AWAY button pushed: ' + peripheral.uuid);
      self.emit('flic_away');
      var msg = '[PRESENCE] Flic ';
      msg += timeSinceLastFlic + ' ';
      msg += now + ' ';
      msg += timeSinceLastFlic;
      log.debug(msg);
    }
    lastFlic = now;
  }

  function sawPerson(peripheral) {
    if (peripheral.uuid === flicUUID) {
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
      log.log('[PRESENCE] Noble State Change: ' + state);
      if (state === 'poweredOn') {
        noble.startScanning([], true);
      } else {
        noble.stopScanning();
        self.emit('adapterError', {'adapterState': state});
        log.exception('[PRESENCE] Unknown adapter state.', state);
      }
    });
    noble.on('scanStart', function() {
      log.log('[PRESENCE] Noble Scanning Started.');
      nobleStarted = true;
      self.emit('scanStarted', false);
    });
    noble.on('scanStop', function() {
      log.log('[PRESENCE] Noble Scanning Stopped.');
      nobleStarted = false;
      self.emit('scanStopped', false);
    });
    noble.on('discover', sawPerson);
    if (nobleStarted === false) {
      noble.startScanning([], true);
    }
  }

  this.setFlicAway = function(uuid) {
    log.log('[PRESENCE] Set Flic Away UUID: ' + uuid);
    lastFlic = Date.now() + (60 * 1000);
    flicUUID = uuid;
  };

  this.addPerson = function(newPerson) {
    try {
      var uuid = newPerson.uuid;
      var person = status[uuid];
      if (person) {
        log.warn('[PRESENCE] ' + newPerson.name + ' already exists.');
        return false;
      }
      status[uuid] = newPerson;
      status[uuid].lastSeen = 0;
      status[uuid].state = AWAY;
      log.log('[PRESENCE] Added: ' + newPerson.name + ' (' + uuid + ')');
      return true;
    } catch (ex) {
      log.exception('[PRESENCE] Error adding new person.', ex);
      return false;
    }
  };

  // TODO Remove person from status and numPresent! 
  this.removePersonByKey = function(uuid) {
    log.todo('Remove person from status and numPresent! ');
    try {
      var person = status[uuid];
      if (person) {
        log.log('[PRESENCE] Removed: ' + person.name + ' (' + uuid + ')');
        status[uuid] = null;
        return true;
      }
      log.warn('[PRESENCE] Could not find ' + uuid + ' to remove.');
      return false;
    } catch (ex) {
      log.exception('[PRESENCE] Error removing person', ex);
      return false;
    }
  };

  // TODO Remove person from numPresent if track==false
  this.updatePerson = function(uPerson) {
    log.todo('Remove person from numPresent if track==false');
    try {
      var uuid = uPerson.uuid;
      var person = status[uuid];
      if (person) {
        status[uuid].name = uPerson.name;
        status[uuid].track = uPerson.track;
        log.log('[PRESENCE] Updated: ' + uPerson.name + ' (' + uuid + ')');
        return true;
      }
      log.warn('[PRESENCE] Could not find ' + uuid + ' to update.');
      return false;
    } catch (ex) {
      log.exception('[PRESENCE] Error updating person.', ex);
      return false;
    }
  };

  this.shutdown = function() {
    stopCheckAwayTimer();
    if (noble) {
      noble.stopScanning();
    }
    nobleStarted = false;
    log.log('[PRESENCE] Shut down.');
  };

  function init() {
    log.init('[PRESENCE]');
    try {
      noble = require('noble');
      startNoble();
      startCheckAwayTimer();
    } catch (ex) {
      log.exception('[PRESENCE] Presence initialization error.', ex);
      setTimeout(function() {
        self.emit('presence_unavailable');
      }, 100);
    }
  }

  init();
}

util.inherits(Presence, EventEmitter);

module.exports = Presence;
