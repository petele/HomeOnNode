var keypress = require("keypress");
var fs = require("fs");
var log = require("../Controller/SystemLog");
var fbHelper = require("../Controller/fbHelper");
var Keys = require("../Controller/Keys");
var webRequest = require("../Controller/webRequest");
var PowerMate = require('node-powermate');

var config;
var modifier;
var powermateLight;

log.appStart("KeyPad");

function listen() {
  // make `process.stdin` begin emitting "keypress" events
  keypress(process.stdin);

  // listen for the "keypress" event
  process.stdin.on('keypress', function (ch, key) {
    if ((key && key.ctrl && key.name === 'c') || (ch === "q")) {
      exit("SIGINT", 0);
    }

    if (ch === "\r") {
      ch = "ENTER";
    } else if (ch === "\t") {
      ch = "TAB";
    } else if (ch === "\x7f") {
      ch = "BS";
    } else if (ch === ".") {
      ch = "DOT";
    } else if (ch === "/") {
      ch = "FW";
    } else if (ch === "#") {
      ch = "HASH";
    } else if (ch === "$") {
      ch = "DOLLAR";
    } else if (ch === "[") {
      ch = "SQOPEN";
    } else if (ch === "]") {
      ch = "SQCLOSE";
    }
    //ch = ch.toString();
    log.http("KEY", ch);
    var m = config.modifiers[ch];
    var k = config.keys[ch];
    if (m) {
      modifier = m;
      setTimeout(function() {
        modifier = undefined;
      }, 5000);
    } else if (k) {
      var uri = {
        "host": config.ip,
        "port": 3000,
        "path": "/state",
        "method": "POST"
      };
      var body = {
        "command": k,
        "modifier": modifier
      };
      body = JSON.stringify(body);
      log.http("REQ", body);
      webRequest.request(uri, body, function(resp) {
        log.http("RESP", JSON.stringify(resp));
      });
      modifier = undefined;
    }
  });

  process.stdin.setRawMode(true);
  process.stdin.resume();
}

function initPowermate(lights, interval) {
  var powermate = new PowerMate();
  var uri = {
    "host": config.powermate.hueIP,
    "path": "/api/" + Keys.keys.hue + "/lights/" + lights[0]
  }
  setInterval(function() {
    webRequest.request(uri, null, function(resp) {
      powermateLight.on = resp.state.on;
      powermateLight.bri = resp.state.bri;
      if (resp.state.on) {
        powermate.setBrightness(resp.state.bri);
      } else {
        powermate.setBrightness(0);
      }
    });
  }, interval);
  powermateLight = {
    "on": true,
    "bri": 0,
    "transitiontime": 1
  };
  powermate.on('buttonDown', function(f) {
    powermateLight.on = !powermateLight.on;
    setLights(lights, powermateLight);
    if (powermateLight.on === false) {
      powermate.setBrightness(0);
    } else {
      powermate.setBrightness(powermateLight.bri);
    }
  });
  powermate.on('wheelTurn', function(f) {
    var newBri = powermateLight.bri + (10 * f) ;
    if (newBri > 255) {
      newBri = 255;
    } else if (newBri < 0) {
      newBri = 0;
    }
    if ((newBri != powermateLight.bri) && (powermateLight.on === true)) {
      try {
        powermateLight.bri = newBri;
        powermate.setBrightness(newBri);
        setLights(lights, powermateLight);
      } catch (ex) {
        console.log("Oops", ex);
      }
    }
  });
  powermate.on("error", function(e) {
    console.log("EEEE",e);
  });
}

function setLights(lights, state) {
  log.log("[POWERMATE] Lights " + lights.toString() + " " + JSON.stringify(state));
  lights.forEach(function(l) {
    var uri = {
      "host": config.powermate.hueIP,
      "path": "/api/" + Keys.keys.hue + "/lights/" + l.toString() + "/state",
      "method": "PUT"
    }
    //delete state.on;
    var body = JSON.stringify(state);
    webRequest.request(uri, body, function(resp) {
      log.debug("[PowerMate] Response" + JSON.stringify(resp));
    });
  });
}



fs.readFile("keypad.json", {"encoding": "utf8"}, function(err, data) {
  if (err) {
    log.error("Unable to open config file.");
  } else {
    config = JSON.parse(data);
    fb = fbHelper.init(Keys.keys.fb, "keypad-" + config.id, exit);
    if (config.powermate) {
      initPowermate(config.powermate.lights, config.powermate.interval);
    }
    log.log("Ready.");
    listen();
  }
});

function exit(sender, exitCode) {
  exitCode = exitCode || 0;
  log.log("[APP] Starting shutdown process");
  log.log("[APP] Will exit with error code: " + String(exitCode));
  setTimeout(function() {
    log.appStop(sender);
    process.exit(exitCode);
  }, 1500);
}

process.on('SIGINT', function() {
  exit("SIGINT", 0);
});
