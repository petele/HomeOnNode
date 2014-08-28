var EventEmitter = require("events").EventEmitter;
var util = require("util");
var log = require("./SystemLog");


function Door(label, pin_num) {
  this.label = label;
  this.state = "UNKNOWN";
  var self = this;

  // try {
  //   var Gpio = require("onoff").Gpio;
  //   var pin = new Gpio(pin_num, "in");

  //   pin.watch(function(err, val) {
  //     log.debug("PIN WATCH" + val.toString());
  //     if (val === 1) {
  //       self.state = "OPEN";
  //     } else {
  //       self.state = "CLOSED";
  //     }
  //     self.emit("change", self.state);
  //   });
  // } catch (ex) {
  //   self.emit("error", ex);
  // }
  log.init("[Door] " + label + " Pin: " + pin_num);
}

util.inherits(Door, EventEmitter);

module.exports = Door;
