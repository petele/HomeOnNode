var EventEmitter = require("events").EventEmitter;
var util = require("util");
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
        _self.state = response;
        _self.emit("update", response);
        _interval = _baseInterval;
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
    lights.forEach(function(elem, idx, arr) {
      var path = ["lights", elem, "state"].join("/");
      path = path.replace("[ID]", elem);
      hueRequest("PUT", path, JSON.stringify(command), callback);
    });
  };

  if (_ip === undefined) {
    this.findHue();
  } else {
    refresh();
  }
}

util.inherits(Hue, EventEmitter);


module.exports = Hue;