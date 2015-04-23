'use strict';

var EventEmitter = require('events').EventEmitter;
var util = require('util');
var fs = require('fs');
var path = require('path');


function InsideTemperature(interval) {
  this.temperature = -1;
  this.baseInterval = interval;
  this.interval = interval;
  this.file = undefined;

  var self = this;
  findFile(function(file) {
    if (file) {
      self.file = file;
      update(self);
    } else {
      self.emit('error', 'Unable to find temperature file.');
    }
  });
}

util.inherits(InsideTemperature, EventEmitter);

var findFile = function(callback) {
  var baseDir = '/sys/bus/w1/devices';
  var baseFile = '/w1_slave';
  fs.readdir(baseDir, function(err, files) {
    if (files) {
      for (var i = 0; i < files.length; i++) {
        if (files[i].indexOf('28') === 0) {
          var file = path.join(baseDir, files[i], baseFile);
          if (callback) {
            callback(file);
          }
          break;
        }
      }
    } else {
      if (callback) {
        callback(undefined);
      }
    }
  });
};


var readData = function(file, callback) {

  fs.readFile(file, {'encoding': 'utf8'}, function(err, data) {
    if (err) {
      callback({'error': err});
    } else {
      var lines = data.split('\n');
      if (lines[0].indexOf('YES', lines[0].length - 3) === -1){
        callback({'error': 'YES not found.'});
      }
      var equalsPos = lines[1].indexOf('t=');
      if (equalsPos !== -1) {
        var tempString = lines[1].substring(equalsPos+2);
        var tempC = parseFloat(tempString) / 1000.0;
        var tempF = tempC * 9.0 / 5.0 + 32.0;
        callback({'f': tempF.toFixed(2), 'c': tempC.toFixed(2)});
      } else {
        callback({'error': 't= not found.'});
      }
    }
  });

};

var update = function(self) {
  readData(self.file, function(response) {
    if (response.error) {
      if (self.interval === self.baseInterval) {
        self.emit('error', response);
        self.interval = 150;
      } else if (self.interval < (self.baseInterval * 3)) {
        self.interval = 1 + Math.floor(self.interval * 1.5);
      }
    } else {
      if (self.temperature !== response.f) {
        self.temperature = response.f;
        self.emit('change', response);
      }
      self.interval = self.baseInterval;
    }
    setTimeout(function() {
      update(self);
    }, self.interval);
  });
};


module.exports = InsideTemperature;
