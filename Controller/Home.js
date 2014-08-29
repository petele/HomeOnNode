var EventEmitter = require("events").EventEmitter;
var util = require("util");
var exec = require("child_process").exec;
var log = require("./SystemLog");
var Keys = require("./Keys");
var fs = require("fs");

var InsideTemperature = require("./InsideTemperature");
var Firebase = require("firebase");
var AirConditioner = require("./AirConditioner");
var Harmony = require("./Harmony");
var Hue = require("./Hue");
var Door = require("./Door");
var GoogleVoice = require("./GoogleVoice");

function Home(config, fb) {
  this.state = {};
  this.harmonyConfig = {};
  var ready = false;
  var _self = this;

  var armingTimer, awayTimer;
  var hue, harmony, airConditioners, insideTemp, doors, gv;

  this.set = function(command, modifier, source) {
    var response = {
      "date": Date.now(),
      "command": command,
      "modifier": modifier,
      "source": source
    };
    var logMsg = "Command Received: " + command + " " + "[" + modifier + "]";
    if (source) {
      logMsg += " from: " + source;
    }
    log.log(logMsg);
    var cmd = config.commands[command];
    if (cmd) {
      if (cmd.system_state) {
        response.state = setState(cmd.system_state);
      }
      if (cmd.hue) {
        response.hue = [];
        for (var i = 0; i < cmd.hue.length; i++) {
          var hue_cmd;
          if ((modifier === "UP") || (modifier === "DOWN")) {
            hue_cmd = modifier;
          } else {
            hue_cmd = modifier || cmd.hue[i].command;
            hue_cmd = config.light_recipes[hue_cmd];
          }
          if (hue_cmd !== undefined) {
            try  {
              response.hue.push(hue.setLights(cmd.hue[i].lights, hue_cmd));
            } catch (ex) {
              response.hue.push(ex);
              log.error("[HOME] Could not set Hue. " + ex.toString());
            }
          } else {
            var msg = "Invalid modifier (" + modifier + ") for Hue.";
            response.hue.push(msg);
            log.error("[HOME] " + msg);
          }
        }
      }
      if (cmd.ac) {
        response.ac = [];
        var acKeys = Object.keys(cmd.ac);
        for (var i = 0; i < acKeys.length; i++) {
          var acID = acKeys[i];
          var curTemp = _self.state.ac[acID];
          try {
            curTemp = parseInt(curTemp, 10);
          } catch (ex) {
            log.error("[HOME] Current AirConditioner[" + acID + "] Temp not an integer. " + curTemp);
            curTemp = config.airconditioners.default_temperature;
          }
          var newTemp;

          if (modifier === undefined) {
            newTemp = cmd.ac[acID];
          } else if (modifier === "Off") {
            newTemp = 0;
          } else if (modifier === "DOWN") {
            newTemp = curTemp - 1;
          } else if (modifier === "UP") {
            newTemp = curTemp + 1;
          }

          if (newTemp !== undefined) {
            response.ac.push(_self.setTemperature(acID, newTemp));
          } else {
            var errorMessage = "[HOME] Invalid modifier (" + String(modifier);
            errorMessage += ") setting air conditioner [" + acID + "]";
            log.error(errorMessage);
          }
        }
      }
      if (cmd.harmony) {
        try {
          var activityID = _self.harmonyConfig.activitiesByName[cmd.harmony];
          response.harmony = harmony.setActivity(activityID);
        } catch (ex) {
          log.error("[HOME] Count net set Harmony activity. " + ex.toString());
          response.harmony = ex;
        }
      }
      if (cmd.sound) {
        playSound(cmd.sound);
      }
    }
    log.debug(response);
    return response;
  };

  this.setTemperature = function(id, temperature) {
    var response = {
      "id": id,
      "requestedTemp": temperature
    };
    log.log("Set AC [" + id + "] to " + temperature.toString() + "F");

    if (temperature === "AUTO") {
      if ((_self.state.temperature.inside >= config.airconditioners.auto.inside) ||
          (_self.state.temperature.outside >= config.airconditioners.auto.outside)) {
        temperature = config.airconditioners.default_temperature;
      } else {
        response.result = "Inside/Outside temp did not meet threshold.";
        return;
      }
    }

    try {
      temperature = parseInt(temperature, 10);
    } catch (ex) {
      log.error("[HOME] New AirConditioner temp not an integer: " + temperature);
      response.warning("Temperature was not an int, used default temp instead.");
      temperature = config.airconditioners.default_temperature;
    }
    response.temperature = temperature;

    try {
      if ((temperature === 0)|| ((temperature >= 60) && (temperature <= 75))) {
        airConditioners[id].setTemperature(temperature, function() {
        });
        _self.state.ac[id] = temperature;
        fbSet("state/ac/" + id, temperature);
      } else {
        var msg = "[HOME] Invalid temperature (" + temperature;
        msg += ") send to air conditioner [" + id + "]";
        log.debug(msg);
        response.error ="Temperature out of range.";
      }
    } catch (ex) {
      response.error = ex;
    }

    return response;
  };

  this.shutdown = function() {
    fbPush("logs/app", {"date": Date.now(), "module": "HOME", "state": "SHUTDOWN"});
    clearInterval(awayTimer);
    if (armingTimer) {
      clearTimeout(armingTimer);
    }
    harmony.close();
  };

  function fbPush(path, value) {
    var fbObj = fb;
    if (path) {
      fbObj = fb.child(path);
    }
    fb.child("state/time").update({"last_updated": Date.now()});
    fbObj.push(value);
  }

  function fbSet(path, value) {
    var fbObj = fb;
    if (path) {
      fbObj = fb.child(path);
    }
    fb.child("state/time").update({"last_updated": Date.now()});
    fbObj.set(value);
  }

  function setState(state) {
    log.log("Set State: " + state);
    if (state === "ARMED") {
      if (armingTimer) {
        clearTimeout(armingTimer);
      }
      armingTimer = setTimeout(function() {
        armingTimer = null;
        setState("AWAY");
        hue.setLights([0], {"on": false});
      }, config.arming_delay);
    } else if (state === "HOME") {
      // Check if we have any new GoogleVoice Messages
      try {
        if (_self.state.gvoice.all > 0) {
          _self.set("GV_NEW");
        }
      } catch (ex) {
        _self.set("GV_ERROR");
        var msg = "[HOME] Error checking GVoice messages on HOME state change.";
        log.error(msg);
      }
    }
    _self.state.system_state = state;
    fbSet("state/system_state", state);
    fbPush("logs/system_state", {"date": Date.now(), "state": state});
    return state;
  }

  function playSound(file) {
    setTimeout(function() {
      var cmd = "mplayer -ao alsa -really-quiet -noconsolecontrols ";
      cmd += file;
      exec(cmd, function(error, stdout, stderr) {
        if (error !== null) {
          log.error("[HOME] PlaySound Error: " + error.toString());
        }
      });
      log.debug("PlaySound: " + file);
    }, 1);
  }

  function initInsideTemp() {
    insideTemp = new InsideTemperature(config.temperature.inside.interval);
    if (_self.state.temperature === undefined) {
      _self.state.temperature = {};
    }
    insideTemp.on("error", function(error) {
      _self.state.temperature.inside = -1;
      fbSet("state/temperature/inside", error);
      log.error("[HOME] Error reading inside temperature: " + error);
    });
    insideTemp.on("change", function(data) {
      var val = parseFloat(data.f).toFixed(2);
      _self.state.temperature.inside = val;
      fbSet("state/temperature/inside", val);
      log.debug("[HOME] Inside temperature is " + val + "F");
    });
  }

  function initOutsideTemp() {
    if (_self.state.temperature === undefined) {
      _self.state.temperature = {};
    }
    var url = "https://publicdata-weather.firebaseio.com/";
    url += config.temperature.outside.city;
    var weatherRef = new Firebase(url);
    weatherRef.child('currently/temperature').on('value', function(snapshot) {
      _self.state.temperature.outside = snapshot.val();
      fbSet("state/temperature/outside", snapshot.val());
      log.debug("[HOME] Outside temperature is " + snapshot.val() + "F");
    });
    weatherRef.child("daily/data/0").on("value", function(snapshot) {
      _self.state.daylight = {
        "sunrise": snapshot.val()["sunriseTime"],
        "sunset": snapshot.val()["sunsetTime"]
      };
      fbSet("state/daylight", _self.state.daylight);
    });
  }

  function initAC() {
    airConditioners = {};
    _self.state.ac = {};
    var ip = config.airconditioners.itach_ip;
    config.airconditioners.ac.forEach(function(elem) {
      var id = elem.id;
      var irPort = elem.irPort;
      var cmds = config.airconditioners.commands[elem.protocol];
      airConditioners[id] = new AirConditioner(id, ip, irPort, cmds);
      _self.state.ac[id] = 0;
      fbSet("state/ac/" + id, 0);
    });
  }

  function initHarmony() {
    harmony = new Harmony(config.harmony.ip, Keys.keys.harmony);
    harmony.on("activity", function(activity) {
      var activityName = activity;
      if (_self.harmonyConfig.activitiesByID) {
        activityName = _self.harmonyConfig.activitiesByID[activity];
      }
      _self.state.harmony_activity_id = activity;
      fbSet("state/harmony_activity_id", activity);
      _self.state.harmony_activity_name = activityName;
      fbSet("state/harmony_activity_name", activityName);
      log.log("[HOME] Harmony activity changed: " + activityName);
    });
    harmony.on("config", function(cfg) {
      var activities = cfg.activity;
      cfg.activitiesByID = {};
      cfg.activitiesByName = {};
      for (var i = 0; i < activities.length; i++) {
        var activity = activities[i];
        cfg.activitiesByID[activity.id] = activity.label;
        cfg.activitiesByName[activity.label] = activity.id;
      }
      _self.harmonyConfig = cfg;
      fbSet("harmony_config", cfg);
    });
    harmony.on("error", function(err) {
      log.error("[HOME] Harmony Error: " + JSON.stringify(err));
    });
    harmony.on("ready", function() {
      harmony.getConfig();
      harmony.getActivity();
    });
  }

  function initHue() {
    hue = new Hue(config.hue.interval, Keys.keys.hue, config.hue.ip);
    hue.on("change", function(data) {
      _self.state.hue = data;
      fbSet("state/hue", data);
    });
    hue.on("update", function(data) {
      //_self.state.hue = data;
      //fbSet("state/hue", data);
    });
    hue.on("error", function (err) {
      var error = {"error": true, "result": err};
      _self.state.hue = error;
      fbSet("state/hue", error);
      log.error("[HOME] Error reading Hue state: " + JSON.stringify(err));
    });
  }

  function initDoor() {
    doors = {};
    _self.state.doors = {};
    config.doors.forEach(function(elem) {
      var door = new Door(elem.label, elem.pin);
      door.on("no-gpio", function(e) {
        _self.state.doors[elem.label] = "NO_GPIO";
        fbSet("state/doors/" + elem.label, "NO_GPIO");
        log.error("[HOME] No GPIO for door " + elem.label + " " + e.toString());
      });
      door.on("change", function(data) {
        if (_self.state.system_state === "AWAY") {
          _self.set("HOME");
        }
        _self.state.doors[elem.label] = data;
        fbSet("state/doors/" + elem.label, data);
        fbPush("logs/door", {"date": Date.now(), "label": elem.label, "state": data});
        log.log("[DOOR] " + elem.label + " " + data);
      });
      doors[elem.label] = door;
    });
  }

  function initGoogleVoice() {
    gv = new GoogleVoice(config.gvoice.interval);
    gv.on("zero", function(count) {
      if (_self.state.system_state === "HOME") {
        _self.set("GV_ZERO");
      }
      _self.state.gvoice = count;
      fbSet("state/gvoice", count);
      log.log("[GOOGLEVOICE] Zero");
    });
    gv.on("new", function(count) {
      if (_self.state.system_state === "HOME") {
        _self.set("GV_NEW");
      }
      _self.state.gvoice = count;
      fbSet("state/gvoice", count);
      log.log("[GOOGLEVOICE] New");
    });
    gv.on("change", function(count) {
      _self.state.gvoice = count;
      fbSet("state/gvoice", count);
      log.log("[GOOGLEVOICE] Change");
    });
    gv.on("error", function(e) {
      if (_self.state.system_state === "HOME") {
        _self.set("GV_ERROR");
      }
      log.error("[GOOGLEVOICE] Error: " + JSON.stringify(e));
    });
  }

  function initAwayWatcher() {
    awayTimer = setInterval(function() {
      if (_self.state.system_state === "AWAY") {
        log.debug("[AWAYMONITOR] - Turning Lights Off");
        hue.setLights([0], {"on": false});
      }
    }, config.away_watch_timer);
  }

  function loadConfig() {
    log.log("[HOME] Reading config from Firebase.");
    fb.child("config").on("value", function(snapshot) {
      config = snapshot.val();
      log.log("[HOME] Config file updated.");
      if (ready === false) {
        init();
      }
      fs.writeFile("config.json", JSON.stringify(config, null, 2));
    });
  }

  function init() {
    ready = true;
    fb.child("state/time").update({"started": Date.now()});
    log.log("[HOME] Initalizing components.");
    setState("AWAY");
    initAC();
    initGoogleVoice();
    initInsideTemp();
    initOutsideTemp();
    initDoor();
    initHarmony();
    initHue();
    initAwayWatcher();
    _self.emit("ready");
    fbPush("logs/app", {"date": Date.now(), "module": "HOME", "state": "READY"});
    playSound(config.ready_sound);
  }

  loadConfig();
  fbPush("logs/app", {"date": Date.now(), "module": "HOME", "state": "STARTING"});
}


util.inherits(Home, EventEmitter);

module.exports = Home;
