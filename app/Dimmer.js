'use strict';

var log = require('./SystemLog');
var webRequest = require('./webRequest');
var Keys = require('./Keys').keys;

function Dimmer(config) {
  var powerMate;

  function init() {
    log.init('[DIMMER]');
    try {
      var PowerMate = require('node-powermate');
      powerMate = new PowerMate();
      powerMate.on('buttonDown', handleButDown);
      powerMate.on('buttonUp', handleButUp);
      powerMate.on('wheelTurn', handleWheelTurn);
      powerMate.on('error', handlePowermateError);
      log.log('[DIMMER] Ready.');
    } catch (ex) {
      log.exception('[DIMMER] Initialization error', ex);
    }
  }

  function handleButDown() {
    log.debug('[POWERMATE] Button Down');
    var uri = {
      'host': config.hueIP,
      'path': '/api/' + Keys.hueBridge.key + '/lights/' + config.lights[0]
    };
    webRequest.request(uri, null, function(resp) {
      if (resp.error) {
        log.exception('[DIMMER] Error getting light status', resp.error);
      } else {
        try {
          var newState = {};
          if (resp.state.on === true) {
            newState.on = false;
          } else {
            newState.on = true;
          }
          setLights(newState);
        } catch (ex) {
          log.exception('[DIMMER] Error getting light state', ex);
        }
      }
    });
  }

  function handleButUp() {
    log.debug('[POWERMATE] Button Up');
  }

  function handleWheelTurn(d) {
    log.debug('[POWERMATE] Wheel Turn - Delta: ' + d.toString());
    setLights({'inc_bri': d});
  }

  function handlePowermateError(err) {
    log.exception('[POWERMATE] Error', err);
  }

  function setLights(state) {
    log.log('[DIMMER] ' + JSON.stringify(state));
    config.lights.forEach(function(l) {
      var uri = {
        'host': config.hueIP,
        'path': '/api/' + Keys.hueBridge.key + '/lights/' + l + '/state',
        'method': 'PUT'
      };
      var body = JSON.stringify(state);
      webRequest.request(uri, body, function(resp) {
        log.debug('[POWERMATE] Response' + JSON.stringify(resp));
      });
    });
  }

  this.close = function() {
    log.log('[POWERMATE] Closing.');
    if (powerMate) {
      powerMate.close(function(obj) {
        log.log('[POWERMATE] Closed.');
      });
    }
  };

  init();
}

module.exports = Dimmer;

