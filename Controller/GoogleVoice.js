var EventEmitter = require("events").EventEmitter;
var util = require("util");
var sys = require("sys");
var exec = require("child_process").exec;
var log = require("./SystemLog");

function GoogleVoice(interval) {
  this.unreadCounts = null;
  this.interval = interval;
  this.baseInterval = interval;
  update(this, true);
  log.init("[GoogleVoice]");
}

util.inherits(GoogleVoice, EventEmitter);

var getData = function(callback) {
  var cmd = "lynx -source https://www.google.com/voice/request/unread";
  exec(cmd, function(error, stdout, stderr) {
    var result;
    try {
      result = JSON.parse(stdout);
      result = result.unreadCounts;
    } catch (ex) {
      result = {"error": ex.message};
    }
    if (error !== null) {
      //logger.debug("gvoice", error);
      result = {"error": error};
    }
    if (callback) {
      callback(result);
    }
  });
};

var update = function(self, fire) {
  getData(function(gvResponse) {
    if (gvResponse.error) {
      if (self.interval === self.baseInterval) {
        self.emit("error", gvResponse.error);
      }
      if (self.interval < (self.baseInterval * 12)) {
        self.interval = Math.floor(self.interval * 1.5);
      }
    } else {
      var changeType;
      if (fire) {
        changeType = "init";
      } else if (gvResponse.all > self.unreadCounts.all) {
        changeType = "new";
      } else if ((gvResponse.all < self.unreadCounts.all) && (gvResponse.all > 0)) {
        changeType = "down";
      } else if ((gvResponse.all === 0) && (self.unreadCounts.all !== 0)) {
        changeType = "zero";
      }
      if (changeType) {
        self.emit("changed", changeType, gvResponse);
        self.unreadCounts = gvResponse;
        self.interval = self.baseInterval;
      }
    }
    setTimeout(function() {
      update(self);
    }, self.interval);
  });
};


module.exports = GoogleVoice;