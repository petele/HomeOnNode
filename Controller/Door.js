var EventEmitter = require("events").EventEmitter;
var util = require("util");
//var Gpio = require("onoff").Gpio;
var log = require("./SystemLog");

function Door(label, pin_num) {
  var Gpio = require("onoff").Gpio,
      pin = new Gpio(pin_num, in);
  this.label = label;
  this.state = "UNKNOWN";
  var self = this;


  pin.watch(function(err, value) {
    log.debug("PIN HERE " + value.toString());
    if (err) {
      log.error("PIN CHANGE ERROR " + err);
      self.emit("error", err);
    } else {
      log.debug("PIN CHANGE " + value.toString());
      if (value === 1) {
        self.state = "OPEN";
      } else {
        self.state = "CLOSED";
      }
      self.emit("change", self.state);
    }
  });
  log.init("[Door] " + label + " Pin: " + pin_num);
}

util.inherits(Door, EventEmitter);

module.exports = Door;
