var log = require("../Controller/SystemLog");
var webRequest = require("../Controller/webRequest");
var Keys = require("../Controller/Keys");
var PowerMate = require('node-powermate');


function Dimmer(config) {
  var powerMate;
  var delta;

  this.butPressed = false;
  this.lightCurrent = {
    bri: 0,
    on: true
  };
  
  function init() {
    delta = 0;
    powerMate = new PowerMate();
    setInterval(getLightState, config.refreshInterval);
    setInterval(updateLightState, config.interval);
    powerMate.on("buttonDown", handleButDown);
    powerMate.on("buttonUp", handleButUp);
    powerMate.on("wheelTurn", handleWheelTurn);
    powerMate.on("error", handlePowermateError);
  }

  function handleButDown() {
    this.butPressed = true;
    this.lightCurrent.on = !this.lightCurrent.on;
    setLights({"on": this.lightCurrent.on});
    log.debug("[PowerMate] Button Down");
  }

  function handleButUp() {
    this.butPressed = false;
    log.debug("[PowerMate] Button Up");
  }

  function handleWheelTurn(d) {
    if ((this.lightCurrent.on === true) && (delta < 255) && (delta > -255)) {
      delta += d;
    } else if ((this.lightCurrent.on === false) && (d > 0)) {
      this.lightCurrent.bri = d;
      this.lightCurrent.on = true;
      setLights({"on": true, "bri": d});
    }
    log.debug("[PowerMate] Wheel Turn - Delta: " + d.toString());
  }

  function handlePowermateError(err) {
    log.error("[PowerMate] Error: " + err.toString());
  }

  function updateLightState() {
    if ((delta !== 0)  &&  (this.lightCurrent.on)) {
      var newBri = this.lightCurrent.bri + delta;
      if (newBri < 0) {
        newBri = 0;
      } else if (newBri > 255) {
        newBri = 255;
      }
      delta = 0;
      this.lightCurrent.bri = newBri;
      setLights({"bri": this.lightCurrent.bri});
    }
  }

  function getLightState() {
    var uri = {
      "host": config.hueIP,
      "path": "/api/" + Keys.keys.hue + "/lights/" + config.lights[0]
    };
    webRequest.request(uri, null, function(resp) {
      try {
        this.lightCurrent.on = resp.state.on;
        this.lightCurrent.bri = resp.state.bri;
        if (resp.state.on) {
          powerMate.setBrightness(resp.state.bri);
        } else {
          powerMate.setBrightness(0);
        }
      } catch (ex) {
        log.error("[PowerMate] Error getting light state: " + ex.toString());
      }
    });
  }

  function setLights(state) {
    log.log("[PowerMate] " + this.lightCurrent.on  + " " + this.lightCurrent.bri);
    var ledBri = 0;
    if (this.lightCurrent.on === true) {
      ledBri = this.lightCurrent.bri;
    }
    try {
      powerMate.setBrightness(ledBri);
    } catch (ex) {
      log.warn("[PowerMate] Error setting PowerMate brightness: " + ex.toString());
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

