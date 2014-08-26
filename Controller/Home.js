var EventEmitter = require("events").EventEmitter;
var GoogleVoice = require("./GoogleVoice");
var Hue = require("./Hue");
var Door = require("./Door");
var InsideTemperature = require("./InsideTemperature");
var Harmony = require("./Harmony");
var AirConditioner = require("./AirConditioner");
var Firebase = require("firebase");
var fs = require("fs");
var sys = require("sys");
var exec = require("child_process").exec;
var util = require("util");
var log = require("./SystemLog");
var Keys = require("./Keys");

var fb, hue, harmony, airConditioners;

function Home() {
  this.state = {
    "system_state": "STARTING",
    "hue": {},
    "door": -1,
    "ac": {},
    "temperature": {
      "inside": -1,
      "outside": -1
    },
    "time": {
      "started": Date.now()
    },
    "harmony_activity": -1,
    "gvoice": {}
  };
  this.config = null;
  readConfig(this);
}

util.inherits(Home, EventEmitter);

Home.prototype.shutdown = function() {
  // TODO: shutdown harmony connection
};

Home.prototype.set = function(command, options) {
  log.log("Command Received: " + command + " " + "[" + options + "]");
  var cmd = this.config.commands[command];
  if (cmd) {
    if (cmd.system_state) {
      setState(cmd.system_state, this);
    }
    if (cmd.hue) {
      for (var i = 0; i < cmd.hue.length; i++) {
        var hue_cmd = options || cmd.hue[i].command;
        hue_cmd = this.config.light_recipes[hue_cmd];
        hue.setLights(cmd.hue[i].lights, hue_cmd);
      }
    }
    if (cmd.ac) {
      var acKeys = Object.keys(cmd.ac);
      for (var i = 0; i < acKeys.length; i++) {
        var temperature = cmd.ac[acKeys[i]];
        this.setACTemperature(acKeys[i], temperature);
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

Home.prototype.setACTemperature = function(id, temperature) {
  log.log("Set AC [" + id + "] to " + temperature + "F");
  if (temperature === "AUTO") {
    if ((this.state.temperature.inside >= this.config.airconditioners.auto.inside) ||
        (this.state.temperature.outside >= this.config.airconditioners.auto.outside)) {
      temperature = this.config.airconditioners.default_temperature;
    } else {
      temperature = null;
    }
  }
  if (temperature !== null) {
    airConditioners[id].setTemperature(temperature);
    this.state.ac[id] = temperature;
    fbSet("state/ac/" + id, temperature);
  }
  return {"result": "OK"};
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

var awayTimeout;
function setState(state, self) {
  log.log("Set State: " + state);
  if (state === "ARMED") {
    if (awayTimeout) {
      clearTimeout(awayTimeout);
    }
    awayTimeout = setTimeout(function() {
      awayTimeout = null;
      setState("AWAY", self);
    }, self.config.away_timeout);
  }
  self.state.system_state = state;
  fbSet("state/system_state", state);
  fbPush("system_state", {"date": Date.now(), "state": state});
}

function readConfig(self) {
  log.log("Reading config files.");
  fs.readFile("config.json", {"encoding": "utf8"}, function(err, data) {
    if (err) {
      log.error("[HOME] Unable to read config.json");
    } else {
      self.config = JSON.parse(data);
      log.log("[HOME] config.json read and parsed");
      onReady(self);
    }
  });
}

var playSound = function(file) {
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
};

function initInsideTemp(self) {
  var insideTemp = new InsideTemperature(self.config.temperature.inside.interval);
  insideTemp.on("error", function(error) {
    log.error("[HOME] Error reading inside temperature: " + error);
    self.state.temperature.inside = error;
    fbSet("state/temperature/inside", error);
  });
  insideTemp.on("update", function(data) {
    self.state.temperature.inside = data.f;
    fbSet("state/temperature/inside", data.f);
    log.debug("[HOME] Inside temperature is " + data.f + "F");
  });
}

function initOutsideTemp(self) {
  var url = "https://publicdata-weather.firebaseio.com/";
  url += self.config.temperature.outside.city + "/currently";
  var weatherRef = new Firebase(url);
  weatherRef.child('temperature').on('value', function(snapshot) {
    self.state.temperature.outside = snapshot.val();
    fbSet("state/temperature/outside", snapshot.val());
    log.debug("[HOME] Outside temperature is " + snapshot.val() + "F");
  });
}

function initAC(self) {
  airConditioners = {};
  var ip = self.config.airconditioners.itach_ip;
  var port = self.config.airconditioners.itach_port;
  self.config.airconditioners.ac.forEach(function(elem, idx, arr) {
    var id = elem.id;
    var cmds = self.config.airconditioners.commands[elem.protocol];
    airConditioners[id] = new AirConditioner(id, ip, port, cmds);
    self.state.ac[id] = 0;
    fbSet("state/ac/" + id, 0);
  });
}

function initHarmony(self) {
  harmony = new Harmony();
  harmony.on("changed", function(activity) {
    self.state.harmony_activity = activity;
    fbSet("staet/harmony_activity", activity);
    log.debug("[HOME] Harmony activity changed: " + activity);
  });
  harmony.getConfig(function(cfg) {
    self.config.harmony = cfg;
    fbSet("harmony", cfg);
  });
}

function initHue(self) {
  hue = new Hue(self.config.hue.interval, Keys.keys.hue, self.config.hue.ip);
  hue.on("update", function(data) {
    self.state.hue = data;
    fbSet("state/hue", data);
  });
  hue.on("error", function (err) {
    var error = {"error": true, "result": err};
    self.state.hue = error;
    fbSet("state/hue", error);
    log.error("[HOME] Error reading Hue state.");
    log.debug(JSON.stringify(err));
  });
}

function initDoor(self) {
  self.state.door = false;
  var door = new Door();
  door.on("no-gpio", function() {
    self.state.door = undefined;
    fbSet("state/door", null);
    log.error("[HOME] No GPIO found for door detection.");
  });
  door.on("changed", function(data) {
    if (self.state.system_state === "AWAY") {
      self.set("HOME");
    }
    self.state.door = data;
    fbSet("state/door", data);
    fbPush("door", {"date": Date.now(), "state": data});
  });
}

function initGoogleVoice(self) {
  var gv = new GoogleVoice(self.config.gvoice.interval);
  gv.on("changed", function(changeType, data) {
    if (changeType === "new") {
      if (self.state.system_state === "HOME") {
        self.set("GV_NEW");
      }
    } else if (changeType === "zero") {
      if (self.state.system_state === "HOME") {
        self.set("GV_ZERO");
      }
    }
    self.state.gvoice = data;
    fbSet("state/gvoice", data);
  });
  gv.on("error", function(error) {
    if (self.state.system_state === "HOME") {
      self.set("GV_ERROR");
      self.state.gvoice = error;
      fbSet("state/gvoice", error);
    }
  });
}

function initFirebase(self) {
  fb = new Firebase("https://boiling-torch-4633.firebaseio.com/");
  fb.auth(Keys.keys.fb, function(error) {
    if(error) {
      
    } else {
      
    }
  });
  fbSet("config", self.config);
  fbPush("system", {"date": Date.now(), "action": "started"});
  fb.child("state").remove();
  fbSet("state", self.state);
}

function onReady(self) {
  if (self.config) {
    self.state.system_state = "AWAY";
    initFirebase(self);
    initAC(self);
    initGoogleVoice(self);
    initInsideTemp(self);
    initOutsideTemp(self);
    initDoor(self);
    initHarmony(self);
    initHue(self);
    self.emit("ready");
    playSound(self.config.ready_sound);
  }
}

module.exports = Home;