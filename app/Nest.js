'use strict';

var EventEmitter = require('events').EventEmitter;
var util = require('util');
var https = require('https');
var log = require('./SystemLog');
var Firebase = require('firebase');

function Nest() {
  var _isReady = false;
  var _fbNest;
  var _self = this;
  var _authExpiresAt;
  var _nestData;

  this.generatePinURL = function(clientId) {
    var url = 'https://home.nest.com/login/oauth2?client_id=' + clientId;
    url += '&state=' + Math.random();
    log.debug('[NEST] Pin Request URL: ' + url);
    return url;
  };

  this.getAccessToken = function(pin, clientId, secret, callback) {
    var path = '/oauth2/access_token?';
    path += 'code=' + pin;
    path += '&client_id=' + clientId;
    path += '&client_secret=' + secret;
    path += '&grant_type=authorization_code';
    var options = {
      hostname: 'api.home.nest.com',
      path: path,
      method: 'POST'
    };
    var request = https.request(options, function(resp) {
      var result = '';
      resp.on('data', function(data) {
        result += data;
      });
      resp.on('end', function() {
        console.log('getAccessToken:', result);
        var r = JSON.parse(result);
        if (callback) {
          callback(r);
        }
      });
    });
    request.end();
    request.on('error', function(err) {
      log.exception('[NEST] Error requesting Access Token', err);
    });
  };

  this.login = function(accessToken) {
    log.init('[NEST]');
    _fbNest = new Firebase('wss://developer-api.nest.com');
    _fbNest.authWithCustomToken(accessToken, function(err, token) {
      if (err) {
        _self.emit('authError', err);
        log.exception('[NEST] Authentication Error', err);
      } else {
        _authExpiresAt = token.expires;
        _isReady = true;
        log.debug('[NEST] Authentication completed successfully.');
        _self.getStatus(function() {
          log.log('[NEST] Ready.');
          initAlarmEvents();
          _self.emit('ready');
        });
        _fbNest.onAuth(function(authToken) {
          if (!authToken) {
            log.error('[NEST] Authentication failed.');
            _self.emit('authError');
          }
        });
      }
    });
  };

  function initAlarmEvents() {
    var protects = getKeys(_nestData.devices.smoke_co_alarms);
    protects.forEach(function(key) {
      var path = 'devices/smoke_co_alarms/' + key;
      var alarmName = _nestData.devices.smoke_co_alarms[key].name;
      _fbNest.child(path + '/co_alarm_state').on('value', function(snap) {
        if (snap.val() !== 'ok') {
          log.log('[NEST] CO ALARM');
          _self.emit('alarm', 'CO', alarmName);
        }
      });
      _fbNest.child(path + '/smoke_alarm_state').on('value', function(snap) {
        if (snap.val() !== 'ok') {
          log.log('[NEST] SMOKE ALARM');
          _self.emit('alarm', 'SMOKE', alarmName);
        }
      });
    });
  }

  function getKeys(data) {
    var keys = Object.keys(data);
    return keys;
  }

  this.getDevices = function() {
    var structures = getKeys(_nestData.structures);
    var firstStructure = structures[0]
    var result = {
      structureId: firstStructure,
      cameras: _nestData.structures[firstStructure].cameras,
      protects: _nestData.structures[firstStructure].smoke_co_alarms,
      thermostats: _nestData.structures[firstStructure].thermostats
    };
    return result;
  }

  this.getStatus = function(callback) {
    if (_isReady === true && _fbNest) {
      _fbNest.once('value', function(snapshot) {
        _nestData = snapshot.val();
        if (callback) {
          callback(null, _nestData);
        }
      });
    } else if (callback) {
      callback(false, null);
    }
  };

  this.enableListener = function() {
    if (_isReady === true && _fbNest) {
      _fbNest.on('value', function(snapshot) {
        _nestData = snapshot.val();
        _self.emit('change', _nestData);
      });
      return true;
    } else {
      return false;
    }
  };

  this.enableCamera = function(cameraId) {
    return setCameraStreamingState(cameraId, true);
  };

  this.disableCamera = function(cameraId) {
    return setCameraStreamingState(cameraId, false);
  };

  function setCameraStreamingState(cameraId, state) {
    if (_isReady === true && _fbNest) {
      if (!cameraId) {
        var devices = _self.getDevices();
        if (devices.cameras) {
          cameraId = _self.getDevices().cameras[0];
        } else {
          log.warn('[NEST] No NestCam found.');
          return false;
        }
      }
      var path = 'devices/cameras/' + cameraId + '/is_streaming';
      _fbNest.child(path).set(state, function(err) {
        onSetComplete(path, err);
      });
      log.log('[NEST] Setting NestCam streaming: ' + state.toString());
      return true;
    } else {
      log.warn('[NEST] Nest not ready or no Nest FB connection available.');
      return false;
    }
  }

  function onSetComplete(path, err) {
    if (err) {
      log.exception('[NEST] ' + err.message + ' at path: ' + path, err);
    }
  }

  this.setAway = function() {
    return setHomeAway('away');
  };

  this.setHome = function() {
    return setHomeAway('home');
  };

  function setHomeAway(state) {
    if (_isReady === true && _fbNest) {
      state = state || 'home';
      log.log('[NEST] Set home state to: ' + state);
      var devices = _self.getDevices();
      var structureId = devices.structureId;
      var path = 'structures/' + structureId + '/away';
      _fbNest.child(path).set(state, function(err) {
        onSetComplete(path, err);
      });
      return true;
    } else {
      return false;
    }
  }

  this.setTemperature = function(thermostat, temperature, mode) {
    mode = mode || 'heat-cool';
    var state = {
      target_temperature_f: temperature,
      mode: mode
    };
    return setThermostat(thermostat, state);
  };

  this.setTemperatureRange = function(thermostat, target, hi, lo, mode) {
    mode = mode || 'heat-cool';
    var state = {
      target_temperature_f: target,
      target_temperature_high_f: hi,
      target_temperature_low_f: lo,
      mode: mode
    };
    return setThermostat(thermostat, state);
  };

  function setThermostat(thermostat, state) {
    if (_isReady === true && _fbNest) {
      //TODO add verification of mode: heat/cool/heat-cool/off
      var fbPath = 'devices/thermostats/' + thermostat;
      log.log('[NEST] Set thermostat ' + thermostat + ' to ' + state.toString());
      _fbNest.child(fbPath).set(state, function(err) {
        onSetComplete(path, err);
      });
      return true;
    } else {
      return false;
    }
  }

}

util.inherits(Nest, EventEmitter);

module.exports = Nest;
