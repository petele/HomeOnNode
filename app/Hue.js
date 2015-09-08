'use strict';

var EventEmitter = require('events').EventEmitter;
var util = require('util');
var diff = require('deep-diff').diff;
var hueApi = require('node-hue-api');
var log = require('./SystemLog');

function Hue(key, ip) {
  var bridgeKey = key;
  var bridgeIP = ip;
  var hueBridge;
  var lightState;
  this.refreshInterval = 1;
  this.defaultRefreshInterval = 20000;
  var self = this;

  this.setLightState = function(lights, cmd, callback) {
    if (hueBridge) {
      lights.forEach(function(light) {
        var result;
        var msg;
        msg = '[HUE] Light: [id] Set to: ' + JSON.stringify(cmd);
        msg = msg.replace('[id]', light);
        try {
          if (light <= 0) {
            result = hueBridge.setGroupLightState(light, cmd);
          } else {
            result = hueBridge.setLightState(light, cmd);
          }
          log.debug(msg);
        } catch (ex) {
          log.exception(msg, ex);
          self.emit('error');
        }
        if (result === false) {
          msg = '[HUE] Error setting light [' + light + '] state to ';
          msg += JSON.stringify(cmd);
          log.error(msg);
        }
      });
    }
  };

  function monitorHue() {
    setTimeout(function() {
      hueBridge.getFullState(function(err, hueState) {
        if (err) {
          log.exception('[HUE] Unable to retrieve light state.', err);
          if (self.refreshInterval < self.defaultRefreshInterval * 5) {
            self.refreshInterval += 2500;
          } else {
            log.error('[HUE] Exceeded maximum timeout, throwing error.');
            self.emit('error');
          }
        } else {
          var lights = hueState.lights;
          var differences = diff(self.lightState, lights);
          if (differences) {
            lightState = lights;
            self.emit('change', lights);
          }
          self.refreshInterval = self.defaultRefreshInterval;
        }
        monitorHue();
      });
    }, self.refreshInterval);
  }

  function init() {
    if (bridgeIP === null || bridgeIP === undefined) {
      log.debug('[HUE] No bridge IP set, starting search.');
      hueApi.nupnpSearch(function(err, result) {
        if (err) {
          log.exception('[HUE] Error searching for Hue Bridge', err);
          self.emit('error');
        } else if (result.length === 0) {
          log.error('[HUE] No Hue bridges found.');
          self.emit('error');
        } else {
          log.debug('[HUE] Bridge found: ' + JSON.stringify(result[0]));
          bridgeIP = result[0].ipaddress;
          init();
        }
      });
    } else {
      log.init('[HUE]');
      hueBridge = hueApi.HueApi(bridgeIP, bridgeKey);
      hueBridge.lights(function(err, lights) {
        if (err) {
          log.exception('[HUE] Error getting initial light state.', err);
        } else {
          lightState = lights;
          log.log('[HUE] Ready.');
          self.emit('ready', lights);
          monitorHue();
        }
      });
    }
  }

  init();
}

util.inherits(Hue, EventEmitter);

module.exports = Hue;
