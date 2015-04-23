'use strict';

var EventEmitter = require('events').EventEmitter;
var log = require('./SystemLog');
var util = require('util');
var noble = require('noble');

function Presence(maxAway) {
  var STATE_AWAY = 'AWAY';
  var STATE_PRESENT = 'PRESENT';
  var MAX_AWAY = maxAway;
  var self = this;
  var nobleStarted = false;
  var status, numPresent, intervalID;

  function emitChange(person) {
    var data = {
      'present': numPresent,
      'state': person.state,
      'person': person
    };
    self.emit('change', data);
    log.log('[Presence] ' + person.name + ' is ' + person.state);
  }

  function timerTick() {
    var keys = Object.keys(status);
    var keyLen = keys.length;
    for (var i = 0; i < keyLen; i++) {
      var person = status[keys[i]];
      var timeSinceLastSeen = (Date.now() - person.lastSeen) / 1000;
      if ((timeSinceLastSeen > MAX_AWAY) && (person.state === STATE_PRESENT)) {
        person.state = STATE_AWAY;
        numPresent -= 1;
        emitChange(person);
      }
    }
  }

  function sawPerson(peripheral) {
    var person = status[peripheral.uuid];
    if (person) {
      person.lastSeen = Date.now();
      if (person.state === STATE_AWAY) {
        person.state = STATE_PRESENT;
        numPresent += 1;
        emitChange(person);
      }
    }
  }

  function startNoble() {
    noble.on('stateChange', function(state) {
      log.log('[Presence] Noble State Change: ' + state);
      if (state === 'poweredOn') {
        self.emit('scanning', true);
        noble.startScanning([], true);
      } else {
        noble.stopScanning();
        self.emit('scanning', false);
        self.emit('error', {'adapterState': state});
      }
    });
    noble.on('scanStart', function() {
      log.log('[Presence] Noble Scanning Started.');
      nobleStarted = true;
    });
    noble.on('scanStop', function() {
      log.log('[Presence] Noble Scanning Stopped.');
      nobleStarted = false;
    });
    noble.on('discover', sawPerson);
    if (nobleStarted === false) {
      noble.startScanning([], true);
    }
  }

  this.addPeople = function(people) {
    if (intervalID) {
      clearInterval(intervalID);
    }
    status = {};
    numPresent = 0;
    if (util.isArray(people) === false) {
      var keys = Object.keys(people);
      var keyLen = keys.length;
      for (var i = 0; i < keyLen; i++) {
        addPerson(people[keys[i]]);
      }
    } else {
      for (var i = 0; i < people.length; i++) {
        addPerson(people[i]);
      }
    }
    log.log('[Presence] Added ' + Object.keys(status).length + ' people.');
    intervalID = setInterval(timerTick, 2000);
  };

  function addPerson(person) {
    if (person.track === true) {
      var p = {
        'name': person.name,
        'uuid': person.uuid,
        'lastSeen': 0,
        'state': STATE_AWAY
      };
      status[person.uuid] = p;
    }
  }

  function init() {
    log.init('[Presence]');
    numPresent = 0;
    status = {};
    startNoble();
  }

  init();
}

util.inherits(Presence, EventEmitter);

module.exports = Presence;
