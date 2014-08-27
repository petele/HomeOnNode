var EventEmitter = require("events").EventEmitter;
var util = require("util");
var gpio = require("rpi-gpio");
var log = require("./SystemLog");


function Door(label, pin) {
  this.label = label;
  this.state = "UNKNOWN";
  var self = this;

  gpio.on("change", function(channel, value) {
    if (channel === pin) {
      if (value === true) {
        self.state = "OPEN";
      } else {
        self.state = "CLOSED";
      }
      self.emit("changed", self.state);
    }
  });
  gpio.setPollFrequency(600);
  gpio.setup(pin, gpio.DIR_IN, function(ex) {
    self.emit("no-gpio", ex);
  });
  log.init("[Door] " + label + " Pin: " + pin);
}

util.inherits(Door, EventEmitter);

module.exports = Door;