'use strict';

var Gpio = require('onoff').Gpio;
var exec = require('child_process').exec;

var doorbellPin = 23;
var debounceTimer = null;
var debounceTimeout = 1500;
var soundFile = '../app/sounds/bell.mp3';

function ringDoorbell() {
  if (debounceTimer) {
    console.warn('[DOORBELL] Debounce.');
    return;
  }
  debounceTimer = setTimeout(function() {
    debounceTimer = null;
  }, debounceTimeout);
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

var pin = new Gpio(doorbellPin, 'in', 'rising');
pin.watch(function(error, value) {
  if (error) {
    console.error('[DOORBELL] Error watching doorbell', error);
  } else {
    ringDoorbell();
  }
});

process.on('SIGINT', function() {
  if (pin) {
    pin.unwatchAll();
    pin.unexport();
  }
  process.exit(0);
});
