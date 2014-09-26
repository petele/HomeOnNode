var fs = require("fs");
var log = require("../Controller/SystemLog");
var fbHelper = require("../Controller/fbHelper");
var webRequest = require("../Controller/webRequest");
var Keys = require("../Controller/Keys");
var PowerMate = require('node-powermate');

var fb, config, powerMate;
var butPressed, delta;
var lightCurrent;

log.appStart("Dimmer");

function initPowermate() {
  butPressed = false;
  delta = 0;
  lightCurrent = {
    bri: 0,
    on: true
  };
  try {
    powerMate = new PowerMate();
    setInterval(getLightState, config.refreshInterval);
    setInterval(updateLightState, config.interval);
    powerMate.on("buttonDown", handleButDown);
    powerMate.on("buttonUp", handleButUp);
    powerMate.on("wheelTurn", handleWheelTurn);
    powerMate.on("error", handlePowermateError);
  } catch (ex) {
    exit("PowerMate Init Failed", 2);
  }
}

function handleButDown(f) {
  butPressed = true;
  lightCurrent.on = !lightCurrent.on;
  setLights({"on": lightCurrent.on});
}

function handleButUp(f) {
  butPressed = false;
}

function handleWheelTurn(d) {
  if ((lightCurrent.on === true) && (delta < 255) && (delta > -255)) {
    delta += d;
  } else if ( (lightCurrent.on === false) && (d > 0)  ) {
    lightCurrent.bri = d;
    lightCurrent.on = true;
    setLights({"on": true, "bri": d})
  }
}

function handlePowermateError(err) {

}

function updateLightState() {
  if ((delta !== 0)  &&  (lightCurrent.on)) {
    var newBri = lightCurrent.bri + delta;
    if (newBri < 0) {
      newBri = 0;
    } else if (newBri > 255) {
      newBri = 255;
    }
    delta = 0;
    lightCurrent.bri = newBri;
    setLights({"bri": lightCurrent.bri});
  }
}

function getLightState() {
  var uri = {
    "host": config.hueIP,
    "path": "/api/" + Keys.keys.hue + "/lights/" + config.lights[0]
  };
  webRequest.request(uri, null, function(resp) {
    try {
      lightCurrent.on = resp.state.on;
      lightCurrent.bri = resp.state.bri;
      if (resp.state.on) {
        powerMate.setBrightness(resp.state.bri);
      } else {
        powerMate.setBrightness(0);
      }
    } catch (ex) {

    }
  });
}

function setLights(state) {
  log.log("[PowerMate] " + lightCurrent.on  + " " + lightCurrent.bri);
  var ledBri = 0;
  if (lightCurrent.on === true) {
    ledBri = lightCurrent.bri;
  }
  try {
    powerMate.setBrightness(ledBri);
  } catch (ex) {

  }
  config.lights.forEach(function(l) {
    var uri = {
      "host": config.hueIP,
      "path": "/api/" + Keys.keys.hue + "/lights/" + l.toString() + "/state",
      "method": "PUT"
    }
    var body = JSON.stringify(state);
    webRequest.request(uri, body, function(resp) {
      log.debug("[PowerMate] Response" + JSON.stringify(resp));
    });
  });
}

fs.readFile("dimmer.json", {"encoding": "utf8"}, function(err, data) {
  if (err) {
    log.error("Unable to open config file.");
  } else {
    config = JSON.parse(data);
    fb = fbHelper.init(Keys.keys.fb, "dimmer-" + config.id, exit);
    initPowermate();
    log.log("Ready.");
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
