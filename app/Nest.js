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
  var _thermostatModes = ['heat', 'cool', 'heat-cool', 'off'];

  /*****************************************************************************
   *
   * Login/Auth Helpers
   *
   ****************************************************************************/

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

  /*****************************************************************************
   *
   * Internal functions
   *
   ****************************************************************************/


  function initAlarmEvents() {
    /* jshint -W106 */
    // jscs:disable requireCamelCaseOrUpperCaseIdentifiers
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
    // jscs:enable
    /* jshint +W106 */
  }

  function getKeys(data) {
    var keys = Object.keys(data);
    return keys;
  }

  function checkIfReady(throwError, alreadyHasData) {
    if (_isReady === true && _fbNest) {
      if (alreadyHasData === false) {
        return true;
      } else if (_nestData) {
        return true;
      }
      return false;
    } else {
      log.error('[NEST] Not ready');
      if (throwError === true) {
        _self.emit('error', 'nest not ready');
      }
      return false;
    }
  }

  function setThermostat(thermostat, state) {
    if (checkIfReady(true)) {
      if (_thermostatModes.indexOf(state.hvac_mode) === -1) {
        log.error('[NEST] Set thermostat: invalid state.');
        return false;
      }
      var fbPath = 'devices/thermostats/' + thermostat;
      var msg = '[NEST] setThermostat (' + thermostat + '): ';
      msg += JSON.stringify(state);
      log.log(msg);
      _fbNest.child(fbPath).set(state, function(err) {
        onSetComplete(fbPath, err);
      });
      return true;
    }
    return false;
  }

  function setCameraStreamingState(cameraId, state) {
    if (checkIfReady(true)) {
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
      log.log('[NEST] enableCamera (' + cameraId + '): ' + state);
      _fbNest.child(path).set(state, function(err) {
        onSetComplete(path, err);
      });
      log.log('[NEST] Setting NestCam streaming: ' + state.toString());
      return true;
    }
    return false;
  }

  function onSetComplete(path, err) {
    if (err) {
      log.exception('[NEST] ' + err.message + ' at path: ' + path, err);
    } else {
      log.debug('[NEST] setComplete: ' + path);
    }
  }

  function setHomeAway(state) {
    if (checkIfReady(false)) {
      state = state || 'home';
      log.log('[NEST] Set home state to: ' + state);
      var devices = _self.getDevices();
      var structureId = devices.structureId;
      var path = 'structures/' + structureId + '/away';
      _fbNest.child(path).set(state, function(err) {
        onSetComplete(path, err);
      });
      return true;
    }
    return false;
  }

  /*****************************************************************************
   *
   * Public API
   *
   ****************************************************************************/

  this.getStatus = function(callback) {
    if (checkIfReady(true, false)) {
      _fbNest.once('value', function(snapshot) {
        _nestData = snapshot.val();
        if (callback) {
          callback(null, _nestData);
        }
      });
      return true;
    } else if (callback) {
      callback(false, null);
    }
    return false;
  };

  this.getDevices = function() {
    if (checkIfReady(true)) {
      var structures = getKeys(_nestData.structures);
      var firstStructure = structures[0];
      /* jshint -W106 */
      // jscs:disable requireCamelCaseOrUpperCaseIdentifiers
      var result = {
        structureId: firstStructure,
        cameras: _nestData.structures[firstStructure].cameras,
        protects: _nestData.structures[firstStructure].smoke_co_alarms,
        thermostats: _nestData.structures[firstStructure].thermostats
      };
      // jscs:enable
      /* jshint +W106 */
      return result;
    }
    return null;
  };

  this.enableListener = function() {
    if (checkIfReady(true)) {
      _fbNest.on('value', function(snapshot) {
        _nestData = snapshot.val();
        _self.emit('change', _nestData);
      });
      return true;
    }
    return false;
  };

  this.enableCamera = function(cameraId) {
    return setCameraStreamingState(cameraId, true);
  };

  this.disableCamera = function(cameraId) {
    return setCameraStreamingState(cameraId, false);
  };

  this.setAway = function() {
    return setHomeAway('away');
  };

  this.setHome = function() {
    return setHomeAway('home');
  };

  this.setETA = function(tripId, etaBegin, etaEnd) {
    if (checkIfReady(true)) {
      var devices = _self.getDevices();
      var structureId = devices.structureId;
      if (_nestData.structures[structureId].away !== 'away') {
        log.warn('[NEST] Unable to set Nest ETA, not in AWAY mode.');
        return false;
      }
      if (etaBegin === 0) {
        log.log('[NEST] cancelled Nest ETA for trip ' + tripId);
      } else {
        log.log('[NEST] set ETA for ' + tripId + ' to ' + etaBegin);
      }
      /* jshint -W106 */
      // jscs:disable requireCamelCaseOrUpperCaseIdentifiers
      var etaObj = {
        trip_id: tripId,
        estimated_arrival_window_begin: etaBegin,
        estimated_arrival_window_end: etaEnd
      };
      // jscs:enable
      /* jshint +W106 */
      var path = 'structures/' + structureId + '/eta';
      _fbNest.child(path).set(etaObj, function(err) {
        onSetComplete(path, err);
      });
    }
    return false;
  };

  this.setTemperature = function(thermostat, mode, temperature) {
    mode = mode || 'heat-cool';
    /* jshint -W106 */
    // jscs:disable requireCamelCaseOrUpperCaseIdentifiers
    var state = {
      hvac_mode: mode
    };
    if (mode !== 'off') {
      state.target_temperature_f = temperature;
    }
    // jscs:enable
    /* jshint +W106 */
    return setThermostat(thermostat, state);
  };

  this.setTemperatureRange = function(thermostat, target, hi, lo, mode) {
    mode = mode || 'heat-cool';
    /* jshint -W106 */
    // jscs:disable requireCamelCaseOrUpperCaseIdentifiers
    var state = {
      target_temperature_f: target,
      target_temperature_high_f: hi,
      target_temperature_low_f: lo,
      hvac_mode: mode
    };
    // jscs:enable
    /* jshint +W106 */
    return setThermostat(thermostat, state);
  };

}

util.inherits(Nest, EventEmitter);

module.exports = Nest;
