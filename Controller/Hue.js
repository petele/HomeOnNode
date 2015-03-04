var EventEmitter = require("events").EventEmitter;
var util = require("util");
var diff = require('deep-diff').diff;
var webRequest = require("./webRequest");

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
    var uri = {
      "host": _ip,
      "path": url,
      "method": method
    };
    webRequest.request(uri, body, callback);
  }

  function diffPrefilter(path, key) {
    if ((path[0] === "config") && (key === "UTC")) {
      return true;
    } else if ((path[0] === "config") && (key === "localtime")) {
      return true;
    } if ((path[0] === "config") && (key === "whitelist")) {
      return true;
    }
    return false;
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
        var differences = diff(_self.state, response, diffPrefilter);
        if (differences) {
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
    var uri = {
      "host": "www.meethue.com",
      "path": "/api/nupnp",
      "secure": true
    }
    webRequest.request(uri, null, function(response) {
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
      var path;
      if (elem === 0) {
        path = "groups/0/action";
      } else {
        path = ["lights", elem, "state"].join("/");
      }
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
