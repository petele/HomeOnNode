var EventEmitter = require("events").EventEmitter;
var log = require("./SystemLog");
var util = require("util");
var noble = require("noble");

function Presence(people) {
  var STATE_AWAY = "AWAY";
  var STATE_PRESENT = "PRESENT";
  var MAX_AWAY = 240;
  var RSSI_THRESHOLD = -90;
  var self = this;
  var nobleStarted = false;
  var status, numPresent, intervalID;

  function emitChange(person) {
    var data = {
      "present": numPresent,
      "state": person.state,
      "person": person
    };
    self.emit("change", data);
    log.log("[Presence] " + person.name + " is " + person.state);
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
    //if (peripheral.rssi > RSSI_THRESHOLD) {
      var uuid = peripheral.uuid;
      var person = status[uuid];
      //console.log("X", uuid, peripheral.advertisement.localName, person);
      if (person) {
        person.lastSeen = Date.now();
        if (person.state === STATE_AWAY) {
          person.state = STATE_PRESENT;
          numPresent += 1;
          emitChange(person);
        }
      }
    //}
  }

  function startNoble() {
    noble.on("stateChange", function(state) {
      log.log("[Presence] Noble State Change: " + state);
      if (state === "poweredOn") {
        noble.startScanning([], true);
      } else {
        noble.stopScanning();
      }
    });
    noble.on("scanStart", function() {
      log.log("[Presence] Noble Scanning Started.");
      nobleStarted = true;
    });
    noble.on("scanStop", function() {
      log.log("[Presence] Noble Scanning Stopped.");
      nobleStarted = false;
    });
    noble.on("discover", sawPerson);
  }

  this.init = function(people) {
    log.init("[Presence]");
    if (intervalID) {
      clearInterval(intervalID);
    }
    status = {};
    numPresent = 0;
    for (var i = 0; i < people.length; i++) {
      var person = {
        "name": people[i].name,
        "uuid": people[i].uuid,
        "lastSeen": 0,
        "state": STATE_AWAY
      };
      status[people[i].uuid] = person;
    }
    log.log("[Presence] Ready. (" + people.length + " users)");
    intervalID = setInterval(timerTick, 2000);
  };

  this.init(people);
  startNoble();
}

util.inherits(Presence, EventEmitter);

module.exports = Presence;
