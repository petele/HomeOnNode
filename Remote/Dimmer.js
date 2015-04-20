var log = require("../Controller/SystemLog");
var webRequest = require("../Controller/webRequest");
var Keys = require("../Controller/Keys");



function Dimmer(config) {
  var powerMate;
  var delta;

  this.butPressed = false;
  this.lightCurrent = {
    bri: 0,
    on: true
  };
  var self = this;

  function init() {
    log.init("[Dimmer]");
    delta = 0;
    try {
      var PowerMate = require('node-powermate');
      powerMate = new PowerMate();
      setInterval(getLightState, config.refreshInterval);
      setInterval(updateLightState, config.interval);
      powerMate.on("buttonDown", handleButDown);
      powerMate.on("buttonUp", handleButUp);
      powerMate.on("wheelTurn", handleWheelTurn);
      powerMate.on("error", handlePowermateError);
      log.log("[Dimmer] Started.");
    } catch (ex) {
      log.error("[Dimmer] Unable to start: " + ex.toString());
    }
  }

  function handleButDown() {
    self.butPressed = true;
    self.lightCurrent.on = !self.lightCurrent.on;
    setLights({"on": self.lightCurrent.on});
    log.debug("[PowerMate] Button Down");
  }

  function handleButUp() {
    self.butPressed = false;
    log.debug("[PowerMate] Button Up");
  }

  function handleWheelTurn(d) {
    if ((self.lightCurrent.on === true) && (delta < 255) && (delta > -255)) {
      delta += d;
    } else if ((self.lightCurrent.on === false) && (d > 0)) {
      self.lightCurrent.bri = d;
      self.lightCurrent.on = true;
      setLights({"on": true, "bri": d});
    }
    log.debug("[PowerMate] Wheel Turn - Delta: " + d.toString());
  }

  function handlePowermateError(err) {
    log.error("[PowerMate] Error: " + err.toString());
  }

  function updateLightState() {
    if ((delta !== 0)  &&  (self.lightCurrent.on)) {
      var newBri = self.lightCurrent.bri + delta;
      if (newBri < 0) {
        newBri = 0;
      } else if (newBri > 255) {
        newBri = 255;
      }
      delta = 0;
      self.lightCurrent.bri = newBri;
      setLights({"bri": self.lightCurrent.bri});
    }
  }

  function getLightState() {
    var uri = {
      "host": config.hueIP,
      "path": "/api/" + Keys.keys.hue + "/lights/" + config.lights[0]
    };
    webRequest.request(uri, null, function(resp) {
      try {
        self.lightCurrent.on = resp.state.on;
        self.lightCurrent.bri = resp.state.bri;
        if (resp.state.on) {
          powerMate.setBrightness(resp.state.bri);
        } else {
          powerMate.setBrightness(0);
        }
      } catch (ex) {
        log.exception("[PowerMate] Error getting light state: ", ex);
      }
    });
  }

  function setLights(state) {
    log.log("[PowerMate] " + self.lightCurrent.on  + " " + self.lightCurrent.bri);
    var ledBri = 0;
    if (self.lightCurrent.on === true) {
      ledBri = self.lightCurrent.bri;
    }
    try {
      powerMate.setBrightness(ledBri);
    } catch (ex) {
      log.exception("[PowerMate] Error setting PowerMate brightness: ", ex);
    }
    config.lights.forEach(function(l) {
      var uri = {
        "host": config.hueIP,
        "path": "/api/" + Keys.keys.hue + "/lights/" + l.toString() + "/state",
        "method": "PUT"
      };
      var body = JSON.stringify(state);
      webRequest.request(uri, body, function(resp) {
        log.debug("[PowerMate] Response" + JSON.stringify(resp));
      });
    });
  }

  init();
}


module.exports = Dimmer;

