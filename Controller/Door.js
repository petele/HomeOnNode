var EventEmitter = require("events").EventEmitter;
var util = require("util");
var Gpio = require("onoff").Gpio;
var log = require("./SystemLog");

function Door(label, pin_num) {
  this.label = label;
  this.state = "UNKNOWN";
  var self = this;

  try {
    var pin = new Gpio(pin_num, "in");

    pin.watch(function(err, val) {
      if (val === true) {
        self.state = "OPEN";
      } else {
        self.state = "CLOSED";
      }
      self.emit("change", self.state);
    });
  } catch (ex) {
    self.emit("error", ex);
  }
  log.init("[Door] " + label + " Pin: " + pin_num);
}

util.inherits(Door, EventEmitter);

module.exports = Door;
