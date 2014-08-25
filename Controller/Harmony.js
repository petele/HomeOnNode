var EventEmitter = require("events").EventEmitter;
var util = require("util");



function Harmony(interval) {
  this.temperature = -1;
  this.baseInterval = interval;
  this.interval = interval;
  this.activityID = -1;
  this.activityName = null;
 
  update(this);
}

util.inherits(Harmony, EventEmitter);

Harmony.prototype.getConfig = function(callback) {
  if (callback) {
    callback({"error": "Not yet implemented."});
  }
};

Harmony.prototype.startActivity = function(activityID, callback) {
  if (callback) {
    callback({"error": "Not yet implemented."});
  }
};

var readData = function(callback) {
  callback({"error": "Not yet implemented."});
};

var update = function(self) {
  readData(function(response) {
    if (response.error) {
      if (self.interval === self.baseInterval) {
        self.interval = 151;
      } else if (self.interval < (self.baseInterval * 12)) {
        self.interval = 1 + Math.floor(self.interval * 1.5);
      }
    } else {
      if (response.activity !== self.activity) {
        self.emit("changed", response.activityID, response.activityName);
        self.activityID = response.activityID;
        self.activityName = response.activityName;
      }
      self.interval = self.baseInterval;
    }
    setTimeout(function() {
      update(self);
    }, self.interval);
  });
};


module.exports = Harmony;