'use strict';

var Gpio = require('onoff').Gpio;
var exec = require('child_process').exec;

var doorbellPin = 23;
var lastPushed = 0;
var minTime = 2500;
var soundFile = '../app/sounds/bell.mp3';

function ringDoorbell() {
  try {
    console.log('[DOORBELL] Ding-Dong');
    var cmd = 'mplayer ' + soundFile;
    exec(cmd, function(error, stdout, stderr) {
      if (error) {
        console.error('[DOORBELL] Error playing sound', error);
      }
    });
  } catch (ex) {
    console.error('[DOORBELL] Failed', ex);
  }
}

var pin = new Gpio(doorbellPin, 'in', 'falling');
pin.watch(function(error, value) {
  var now = Date.now();
  if (now > lastPushed + minTime) {
    lastPushed = now;
    ringDoorbell();
  } else {
    console.warn('[DOORBELL] Debounced.');
  }
});

process.on('SIGINT', function() {
  if (pin) {
    pin.unwatchAll();
    pin.unexport();
  }
  process.exit(0);
});
