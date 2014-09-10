var EventEmitter = require("events").EventEmitter;
var util = require("util");
var diff = require('deep-diff').diff;
var httpHelper = require("./httpHelper");
var httpsHelper = require("./httpsHelper");

function Hue(interval, key, ip) {
  var _ip = ip;
  var _key = key;
  var _interval = interval;
  var _baseInterval = interval;
  var _self = this;
  this.state = {};

  function hueRequest(method, path, body, callback) {
    var url = "/api/" + _key;
    if (path) {
      url += "/" + path;
    }
    var options = {
      hostname: _ip,
      port: 80,
      path: url,
      method: method
    };
    httpHelper.request(options, body, callback);
  }

  function refresh() {
    hueRequest("GET", null, null, function(response) {
      if (response.error) {
        if (_interval === _baseInterval) {
          _self.emit("error", response.error);
          _interval = 501;
        } else if (_interval < (_baseInterval * 3)) {
          _interval = 1 + Math.floor(_interval * 1.75);
        }
      } else {
        // delete response.config.UTC;
        // delete response.config.localtime;
        var differences = diff(_self.state, response);
        if (differences.length > 2) {
          _self.state = response;
          _self.emit("change", response);
          _interval = _baseInterval;
        }
        _self.emit("update", response);
      }
      setTimeout(refresh, _interval);
    });
  }

  this.findHue = function() {
    httpsHelper.get("www.meethue.com", "/api/nupnp", function(response) {
      response = JSON.parse(response);
      if (response.ipaddress) {
        _ip = response.ipaddress;
        refresh();
      }
    });
  };

  this.setLights = function(lights, command, callback) {
    var response = [];
    lights.forEach(function(elem) {
      var path = ["lights", elem, "state"].join("/");
      path = path.replace("[ID]", elem);
      if ((command === "UP") || (command === "DOWN")) {
        // get the current brightness
        var light;
        try {
          light = _self.state.lights[elem].state;
        } catch (ex) {
          light = {"bri": 125, "on": true, "ct": 369};
        }
        if (light.on === false) {
          light.bri = 0;
        }
        if (command === "UP") {
          command = {"bri": light.bri + 10};
        } else if (command === "DOWN") {
          command = {"bri": light.bri - 10};
        }
        command.on = true;
        if (command.bri > 255) {
          command.bri = 255;
        } else if (command.bri < 0) {
          command.bri = 0;
        }
        _self.state.lights[elem].state.bri = command.bri;
      }
      hueRequest("PUT", path, JSON.stringify(command), callback);
      command.lightID = elem;
      response.push(command);
    });
    return response;
  };

  if (_ip === undefined) {
    this.findHue();
  } else {
    refresh();
  }
}

util.inherits(Hue, EventEmitter);

module.exports = Hue;
