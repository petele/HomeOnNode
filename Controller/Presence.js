var EventEmitter = require("events").EventEmitter;
var log = require("./SystemLog");
var util = require("util");

function Presence(peopleToAdd) {
  var self = this;
  var STATE_PRESENT = "PRESENT";
  var STATE_AWAY = "AWAY";
  var MAX_AWAY = 180;
  var status, macAddr, numPresent;

  this.getStatus = function() {
    return status;
  };

  function presenceCheckTick() {
    var keys = Object.keys(status);
    var keyLen = keys.length;
    for (var i = 0; i < keyLen; i++) {
      var person = status[keys[i]];
      var timeSinceLastSeen = (Date.now() - person.lastSeen) / 1000;
      if ((timeSinceLastSeen > MAX_AWAY) && (person.state === STATE_PRESENT)) {
        person.state = STATE_AWAY;
        self.emit("change", person);
        log.debug("[Presence] " + person.name + " is " + person.state);
        numPresent -= 1;
        if (numPresent === 0) {
          self.emit("none", {"numPresent": 0});
          log.debug("[Presence] Everyone is gone.");
        }
      } else if ((timeSinceLastSeen < 30) && (person.state === STATE_AWAY)) {
        person.state = STATE_PRESENT;
        self.emit("change", person);
        log.debug("[Presence] " + person.name + " is " + person.state);
        numPresent += 1;
      }
    }
  }

  this.createPeopleList = function(people) {
    try {
      var newStatus = {};
      var newMacAddr = [];
      for (var i = 0; i < people.length; i++) {
        var user = {
          "name": people[i].name,
          "mac": people[i].mac,
          "lastSeen": 0,
          "state": STATE_AWAY
        };
        newStatus[people[i].mac] = user;
        newMacAddr.push(people[i].mac);
      }
      status = newStatus;
      macAddr = newMacAddr;
    } catch (ex) {
      log.error("[Presence] Error creating people list: " + ex);
    }
  };

  function init() {
    log.init("[Presence]");
    status = {};
    macAddr = [];
    numPresent = 0;
    self.createPeopleList(peopleToAdd);

    setInterval(presenceCheckTick, 5000);
  }

  init();
}

util.inherits(Presence, EventEmitter);

module.exports = Presence;
