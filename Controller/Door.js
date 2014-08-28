var EventEmitter = require("events").EventEmitter;
var util = require("util");
var gpio = require("onoff").Gpio;
var log = require("./SystemLog");


function Door(label, pin) {
  this.label = label;
  this.state = "UNKNOWN";
  var self = this;

  try {
    var pin = new Gpio(pin, "in", "both");

    pin.watch(function(err, val) {
      if (val === true) {
        self.state = "OPEN";
      } else {
        self.state = "CLOSED";
      }
      self.emit("change", self.state);
    });
  } except (ex) {
    self.emit("error", ex);
  }
  log.init("[Door] " + label + " Pin: " + pin);
}

util.inherits(Door, EventEmitter);

module.exports = Door;
