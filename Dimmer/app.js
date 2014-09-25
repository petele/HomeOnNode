var fs = require("fs");
var log = require("../Controller/SystemLog");
var fbHelper = require("../Controller/fbHelper");
var webRequest = require("../Controller/webRequest");
var Keys = require("../Controller/Keys");
var PowerMate = require('node-powermate');

var fb, config, powerMate;
var butPressed; 
var lightCurrent, lightNew;

log.appStart("Dimmer");

function initPowermate() {
  butPressed = false;
  lightNew = {};
  lightCurrent = {
    "on": false,
    "bri": 0
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
}

function handleButUp(f) {
  butPressed = false;

}

function handleWheelTurn(delta) {

}

function handlePowermateError(err) {

}

function updateLightState() {

}

function getLightState() {
  var uri = {
    "host": config.hueIP,
    "path": "/api/" + Keys.keys.hue + "/lights/" + config.lights[0]
  };
  webRequest.request(uri, null, function(resp) {
    powermateLight.on = resp.state.on;
    powermateLight.bri = resp.state.bri;
    if (resp.state.on) {
      powerMate.setBrightness(resp.state.bri);
    } else {
      powerMate.setBrightness(0);
    }
  });
}


// function setLights(lights, state) {
//   log.log("[POWERMATE] Lights " + lights.toString() + " " + JSON.stringify(state));
//   lights.forEach(function(l) {
//     var uri = {
//       "host": config.hueIP,
//       "path": "/api/" + Keys.keys.hue + "/lights/" + l.toString() + "/state",
//       "method": "PUT"
//     }
//     //delete state.on;
//     var body = JSON.stringify(state);
//     webRequest.request(uri, body, function(resp) {
//       log.debug("[PowerMate] Response" + JSON.stringify(resp));
//     });
//   });
// }

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