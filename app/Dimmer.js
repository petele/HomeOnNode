'use strict';

var log = require('./SystemLog');
var hueApi = require('node-hue-api');
var Keys = require('./Keys').keys;

function Dimmer(config) {
  var powerMate;
  var hueBridge;
  var delta = 0;
  var updateInterval;

  function init() {
    log.init('[DIMMER]');
    try {
      var PowerMate = require('node-powermate');
      powerMate = new PowerMate();
      powerMate.on('buttonDown', handleButDown);
      powerMate.on('buttonUp', handleButUp);
      powerMate.on('wheelTurn', handleWheelTurn);
      powerMate.on('error', handlePowermateError);
      updateInterval = setInterval(updateBrightness, 300);
      hueBridge = hueApi.HueApi(config.hueIP, Keys.hueBridge.key);
      setTimeout(function() {
        try {
          powerMate.setBrightness(0);
          log.debug('[POWERMATE] Brightness set to 0');
        } catch (ex) {
          log.exception('[POWERMATE] Unable to set PowerMate brightness to 0', ex);
        }
      }, 1250);
      log.log('[DIMMER] Ready.');
    } catch (ex) {
      log.exception('[DIMMER] Initialization error', ex);
    }
  }

  function handleButDown() {
    log.debug('[POWERMATE] Button Down');
    hueBridge.lightStatus(config.hueLight, function(err, result) {
      if (err) {
        log.exception('[DIMMER] Error getting light status', err);
      } else {
        var newState = {};
        if (result.state.on === true) {
          newState.on = false;
        } else {
          newState.on = true;
        }
        hueBridge.setGroupLightState(config.hueGroup, newState);
      }
    });
  }

  function handleButUp() {
    log.debug('[POWERMATE] Button Up');
  }

  function updateBrightness() {
    try {
      if (delta !== 0) {
        var newState = {bri_inc: delta, transitiontime: 0};
        hueBridge.setGroupLightState(config.hueGroup, newState);
        delta = 0;
      }
    } catch (ex) {
      log.exception('[POWERMATE] Unable to update brightness.', ex);
    }
  }

  function handleWheelTurn(d) {
    log.debug('[POWERMATE] Wheel Turn - Delta: ' + d.toString());
    delta += (d * 2);
  }

  function handlePowermateError(err) {
    log.exception('[POWERMATE] Error', err);
  }

  this.close = function() {
    log.log('[POWERMATE] Closing.');
    if (updateInterval) {
      clearInterval(updateInterval);
      updateInterval = null;
    }
    if (powerMate) {
      powerMate.close(function(obj) {
        log.log('[POWERMATE] Closed.');
      });
    }

  };

  init();
}

module.exports = Dimmer;

