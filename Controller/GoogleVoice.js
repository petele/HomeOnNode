var EventEmitter = require("events").EventEmitter;
var util = require("util");
var sys = require("sys");
var exec = require("child_process").exec;
var log = require("./SystemLog");

function GoogleVoice(baseInterval) {
  this.unread = -1;
  this.error = false;
  var interval = baseInterval;
  var _self = this;

  function refresh() {
    var cmd = "lynx -source https://www.google.com/voice/request/unread";
    exec(cmd, function(error, stdout, stderr) {
      var result = {};
      if (stderr) {
        if (stderr === "") {
          log.warn("[GOOGLEVOICE] Empty STDError");
        } else {
          log.error("[GOOGLEVOICE] STDError: " + stderr);
          result = {"error": stderr};
        }
      } else {
        try {
          result = JSON.parse(stdout);
          interval = result.pollInterval;
          if ((result.unreadCounts.all === 0) && (_self.unread !== 0)) {
            _self.emit("zero", result.unreadCounts);
          } else if (result.unreadCounts.all < _self.unread) {
            _self.emit("change", result.unreadCounts);
          } else if (result.unreadCounts.all > _self.unread) {
            _self.emit("new", result.unreadCounts);
          }
          _self.unread = result.unreadCounts.all;
          _self.error = false;
        } catch (ex) {
          log.debug("[GOOGLEVOICE] Error: " + ex.message);
          log.debug("[GOOGLEVOICE] STDOut: " + stdout);
          log.debug("[GOOGLEVOICE] Result: " + result);
          result = {
            "error": ex.message,
            "stdout": stdout,
            "result": result
          };
        }
      }
      if (result.error) {
        if (_self.error === false) {
          _self.emit("error", result);
          _self.error = true;
        }
        if (interval < (baseInterval * 12)) {
          interval = Math.floor(interval * 1.5);
        }
      }

      setTimeout(function() {
        refresh();
      }, interval);

    });
  }

  refresh();

}

util.inherits(GoogleVoice, EventEmitter);


module.exports = GoogleVoice;
