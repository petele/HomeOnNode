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

  this.set = function(command, options, source) {
    var logMsg = "Command Received: " + command + " " + "[" + options + "]";
    if (source) {
      logMsg += " from: " + source;
    }
    log.log(logMsg);
    var cmd = config.commands[command];
    if (cmd) {
      if (cmd.system_state) {
        setState(cmd.system_state);
      }
      if (cmd.hue) {
        for (var i = 0; i < cmd.hue.length; i++) {
          var hue_cmd = options || cmd.hue[i].command;
          hue_cmd = config.light_recipes[hue_cmd];
          hue.setLights(cmd.hue[i].lights, hue_cmd);
        }
      }
      if (cmd.ac) {
        var acKeys = Object.keys(cmd.ac);
        for (var i = 0; i < acKeys.length; i++) {
          var temperature = cmd.ac[acKeys[i]];
          _self.setTemperature(acKeys[i], temperature);
        }
      }
      if (cmd.harmony) {
        harmony.startActivity(cmd.harmony);
      }
      if (cmd.sound) {
        playSound(cmd.sound);
      }
    }
    return {"result": "OK"};
  };

  this.setTemperature = function(id, temperature) {
    log.log("Set AC [" + id + "] to " + temperature.toString() + "F");

    // determine if we should turn the AC on or not. If not, we'll set the
    // temp to -1.
    if (temperature === "AUTO") {
      if ((_self.state.temperature.inside >= config.airconditioners.auto.inside) ||
          (_self.state.temperature.outside >= config.airconditioners.auto.outside)) {
        temperature = config.airconditioners.default_temperature;
      } else {
        temperature = -1;
      }
    }
    temperature = parseInt(temperature, 10);

    if (temperature >= 0) {
      airConditioners[id].setTemperature(temperature, function(response) {
      });
      _self.state.ac[id] = temperature;
      fbSet("state/ac/" + id, temperature);
    }

    return {"result": "OK"};
  };

  this.shutdown = function() {
    fbPush("logs/app", {"date": Date.now(), "module": "HOME", "state": "SHUTDOWN"});
    clearInterval(awayTimer);
    if (armingTimer) {
      clearTimeout(armingTimer);
    }
    harmony.close();
    // would be nice to log a shutdown time.
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
    }
    _self.state.system_state = state;
    fbSet("state/system_state", state);
    fbPush("logs/system_state", {"date": Date.now(), "state": state});
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
    url += config.temperature.outside.city + "/currently";
    var weatherRef = new Firebase(url);
    weatherRef.child('temperature').on('value', function(snapshot) {
      _self.state.temperature.outside = snapshot.val();
      fbSet("state/temperature/outside", snapshot.val());
      log.debug("[HOME] Outside temperature is " + snapshot.val() + "F");
    });
  }

  function initAC() {
    airConditioners = {};
    _self.state.ac = {};
    var ip = config.airconditioners.itach_ip;
    config.airconditioners.ac.forEach(function(elem) {
      var id = elem.id;
      var itach_port = elem.port;
      var cmds = config.airconditioners.commands[elem.protocol];
      airConditioners[id] = new AirConditioner(id, ip, itach_port, cmds);
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
    hue.on("update", function(data) {
      _self.state.hue = data;
      fbSet("state/hue", data);
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
