var EventEmitter = require("events").EventEmitter;
var util = require("util");
var gpio = require("rpi-gpio");
var log = require("./SystemLog");


function Door() {
  this.opened = false;
  this.closed = !this.opened;

  var self = this;
  gpio.on("change", function(channel, value) {
    if (value === true) {
      self.opened = true;
    } else {
      self.opened = false;
    }
    self.emit("changed", value);
  });
  gpio.setPollFrequency(600);
  gpio.setup(23, gpio.DIR_IN, function(ex) {
    self.emit("no-gpio", ex);
    self.opened = undefined;
    self.closed = undefined;
  });
  log.init("[Door]");
}

util.inherits(Door, EventEmitter);

module.exports = Door;