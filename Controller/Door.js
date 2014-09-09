var os = require("os");
var EventEmitter = require("events").EventEmitter;
var util = require("util");
var log = require("./SystemLog");

function Door(label, pin_num) {
  this.state = "UNKNOWN";
  var self = this;

  function init() {

    log.init("[Door] " + label + " Pin: " + pin_num);
    if (os.arch() !== "arm") {
      // This is a hack because otherwise the no-gpio event is not caught
      setTimeout(function() {
        self.state = "NOT_AVAILABLE";
        self.emit("no-gpio", "Invalid architecture.");
      }, 150);
    } else {
      var Gpio = require("onoff").Gpio;
      var pin = new Gpio(pin_num, "in", "both");
      pin.watch(function(error, value) {
        log.debug("[DOOR] Pin Changed: " + value);
        if (value === 1) {
          self.state = "OPEN";
        } else {
          self.state = "CLOSED";
        }
        self.emit("change", self.state);
      });
    }
  }

  init();
}

util.inherits(Door, EventEmitter);

module.exports = Door;
