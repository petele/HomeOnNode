'use strict';

var EventEmitter = require('events').EventEmitter;
var util = require('util');
var https = require('https');
var log = require('./SystemLog2');
var Firebase = require('firebase');

var LOG_PREFIX = 'NEST';

function Nest() {
  var _isReady = false;
  var _fbNest;
  var _self = this;
  var _authExpiresAt;
  var _nestData;
  var _thermostatModes = ['heat', 'cool', 'off'];
  var _disconnectedTimer = null;

  /*****************************************************************************
   *
   * Login/Auth Helpers
   *
   ****************************************************************************/

  this.generatePinURL = function(clientId) {
    var url = 'https://home.nest.com/login/oauth2?client_id=' + clientId;
    url += '&state=' + Math.random();
    log.debug(LOG_PREFIX, 'Pin Request URL: ' + url);
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
      log.exception(LOG_PREFIX, 'Error requesting Access Token', err);
    });
  };

  this.login = function(accessToken) {
    log.init(LOG_PREFIX, 'Init');
    _fbNest = new Firebase('https://developer-api.nest.com');
    _fbNest.authWithCustomToken(accessToken, function(err, token) {
      if (err) {
        _self.emit('authError', err);
        log.exception(LOG_PREFIX, 'Authentication Error', err);
      } else {
        _authExpiresAt = token.expires;
        _isReady = true;
        log.log(LOG_PREFIX, 'Authentication completed successfully.');
        log.debug(LOG_PREFIX, 'Authentication expires at ' + _authExpiresAt);
        _self.getStatus(function() {
          log.log(LOG_PREFIX, 'Ready.');
          initAlarmEvents();
          monitorThermostats();
          _self.emit('ready');
        });
        _fbNest.onAuth(function(authToken) {
          if (!authToken) {
            log.error(LOG_PREFIX, 'Authentication failed.');
            _self.emit('authError');
          }
        });
      }
    });
    _fbNest.child('.info/connected').on('value', function(snapshot) {
      if (snapshot.val() === true) {
        log.log(LOG_PREFIX, 'Connected to Nest backend.');
        if (_disconnectedTimer) {
          clearTimeout(_disconnectedTimer);
          _disconnectedTimer = null;
        }
      } else {
        log.warn(LOG_PREFIX, 'No connection to Nest backend.');
        _disconnectedTimer = setTimeout(disconnectTimeExceeded, 60 * 5 * 1000);
      }
    });
  };

  /*****************************************************************************
   *
   * Internal functions
   *
   ****************************************************************************/

  function disconnectTimeExceeded() {
    log.error(LOG_PREFIX, 'Disconnect timeout exceeded!');
    _isReady = false;
  }

  function initAlarmEvents() {
    /* jshint -W106 */
    // jscs:disable requireCamelCaseOrUpperCaseIdentifiers
    var protects = getKeys(_nestData.devices.smoke_co_alarms);
    protects.forEach(function(key) {
      var path = 'devices/smoke_co_alarms/' + key;
      var alarmName = _nestData.devices.smoke_co_alarms[key].name;
      var msg = 'Registering for alarms from: ';
      log.log(LOG_PREFIX, msg + alarmName);
      _fbNest.child(path + '/co_alarm_state').on('value', function(snap) {
        if (snap.val() !== 'ok') {
          log.warn(LOG_PREFIX, 'CO ALARM');
          _self.emit('alarm', 'CO', alarmName);
        }
      });
      _fbNest.child(path + '/smoke_alarm_state').on('value', function(snap) {
        if (snap.val() !== 'ok') {
          log.warn(LOG_PREFIX, 'SMOKE ALARM');
          _self.emit('alarm', 'SMOKE', alarmName);
        }
      });
    });
    // jscs:enable
    /* jshint +W106 */
  }

  function monitorThermostats() {
    var thermostats = getKeys(_nestData.devices.thermostats);
    thermostats.forEach(function(key) {
      log.debug(LOG_PREFIX, 'Registering for thermostat online events for: ' + key);
      var path = 'devices/thermostats/' + key + '/is_online';
      _fbNest.child(path).on('value', function(snapshot) {
        var isOnline = snapshot.val();
        var thermostatName = _nestData.devices.thermostats[key].name;
        var msg = thermostatName + ' thermostat isOnline: ';
        msg += isOnline.toString();
        if (isOnline === true) {
          log.log(LOG_PREFIX, msg);
        } else {
          log.warn(LOG_PREFIX, msg);
        }
      });
    });
  }

  function getKeys(data) {
    var keys = Object.keys(data);
    return keys;
  }

  function checkIfReady(throwError, alreadyHasData) {
    if (_isReady === true && _fbNest) {
      if (_disconnectedTimer) {
        log.warn(LOG_PREFIX, 'Attempting to send command while disconnected.');
      }
      if (alreadyHasData === false) {
        return true;
      } else if (_nestData) {
        return true;
      }
      return false;
    } else {
      log.error(LOG_PREFIX, 'Not ready');
      if (throwError === true) {
        _self.emit('error', 'nest not ready');
      }
      return false;
    }
  }

  function setThermostatMode(thermostat, newMode, newTemp) {
    /* jshint -W106 */
    // jscs:disable requireCamelCaseOrUpperCaseIdentifiers
    var msg = 'setThermostatMode in ' + thermostat.name + ' to: ';
    msg += newMode;
    if (_thermostatModes.indexOf(newMode) === -1) {
      log.error(LOG_PREFIX, msg + ' failed. Invalid mode (' + newMode + ')');
      return false;
    }
    if (thermostat.is_online !== false) {
      log.warn(LOG_PREFIX, msg + ' may fail, thermostat may be offline.');
    }
    log.debug(LOG_PREFIX, msg);
    var path = 'devices/thermostats/' + thermostat.device_id + '/hvac_mode';
    _fbNest.child(path).set(newMode, function(err) {
      if (err) {
        log.exception(LOG_PREFIX, msg, err);
      } else {
        log.debug(LOG_PREFIX, msg + ' - success');
        if (newMode !== 'off') {
          setThermostatTemp(thermostat, newTemp);
        }
      }
    });
    // jscs:enable
    /* jshint +W106 */
    return true;
  }

  function setThermostatTemp(thermostat, newTemp) {
    /* jshint -W106 */
    // jscs:disable requireCamelCaseOrUpperCaseIdentifiers
    var msg = 'setThermostatTemp in ' + thermostat.name + ' to: ';
    msg += newTemp + '°F';
    if (thermostat.is_online !== false) {
      log.warn(LOG_PREFIX, msg + ' may fail, thermostat may be offline.');
    }
    log.debug(LOG_PREFIX, msg);
    var path = 'devices/thermostats/' + thermostat.device_id;
    path += '/target_temperature_f';
    _fbNest.child(path).set(newTemp, function(err) {
      if (err) {
        log.exception(LOG_PREFIX, msg, err);
      } else {
        log.debug(LOG_PREFIX, msg + ' - success');
      }
    });
    // jscs:enable
    /* jshint +W106 */
    return true;
  }

  function setCameraStreamingState(cameraId, state) {
    if (checkIfReady(true)) {
      if (!cameraId) {
        var devices = _self.getDevices();
        if (devices.cameras) {
          cameraId = _self.getDevices().cameras[0];
        } else {
          log.warn(LOG_PREFIX, 'No NestCam found.');
          return false;
        }
      }
      var path = 'devices/cameras/' + cameraId + '/is_streaming';
      var cameraName = cameraId;
      try {
        cameraName = _nestData.devices.cameras[cameraId].name;
      } catch (ex) {
        var exMsg = 'Unable to get Camera name for cameraId:' + cameraId;
        log.exception(LOG_PREFIX, exMsg, ex);
      }
      log.log(LOG_PREFIX, 'setCameraStreamingState (' + cameraName + '): ' + state);
      _fbNest.child(path).set(state, function(err) {
        onSetComplete(path, err);
      });
      return true;
    }
    return false;
  }

  function onSetComplete(path, err) {
    if (err) {
      log.exception(LOG_PREFIX, err.message + ' at path: ' + path, err);
    } else {
      log.debug(LOG_PREFIX, 'setComplete: ' + path);
    }
  }

  function setHomeAway(state) {
    if (checkIfReady(false)) {
      state = state || 'home';
      log.log(LOG_PREFIX, 'Set home state to: ' + state);
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
        log.warn(LOG_PREFIX, 'Unable to set Nest ETA, not in AWAY mode.');
        return false;
      }
      if (etaBegin === 0) {
        log.log(LOG_PREFIX, 'cancelled Nest ETA for trip ' + tripId);
      } else {
        log.log(LOG_PREFIX, 'set ETA for ' + tripId + ' to ' + etaBegin);
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

  this.setTemperature = function(thermostatId, mode, temperature) {
    var msg = 'setTemperature';
    if (checkIfReady(true)) {
      if (!thermostatId) {
        log.error(LOG_PREFIX, msg + ' no thermostatId provided.');
        return false;
      }
      var nestThermostat = _nestData.devices.thermostats[thermostatId];
      if (!nestThermostat) {
        log.error(LOG_PREFIX, msg + ' could not find thermostat (' + thermostatId + ')');
        return false;
      }
      msg += ' in ' + nestThermostat.name;
      if (temperature >= 55 && temperature <= 85) {
        if (mode !== 'off') {
          msg += ' to ' + temperature.toString() + '°F';
        }
      } else {
        log.error(LOG_PREFIX, msg + '. Error: temperature out of range: ' + temperature);
        return false;
      }
      if (!mode) {
        log.error(LOG_PREFIX, msg + '. Error: no mode provided.');
        return false;
      }
      msg += ' [' + mode + ']';

      /* jshint -W106 */
      // jscs:disable requireCamelCaseOrUpperCaseIdentifiers
      if (mode !== nestThermostat.hvac_mode) {
        log.log(LOG_PREFIX, msg);
        setThermostatMode(nestThermostat, mode, temperature);
        return true;
      } else if (mode === 'off') {
        log.warn(LOG_PREFIX, msg + '. (already off, no action required.)');
        return true;
      } else if (nestThermostat.hvac_mode !== 'off') {
        log.log(LOG_PREFIX, msg);
        setThermostatTemp(nestThermostat, temperature);
        return true;
      }
      // jscs:enable
      /* jshint +W106 */
      log.warn(LOG_PREFIX, msg + ' -- Unhandled Event! (' + mode + '/' + temperature + ')');
      return false;
    }
    return false;
  };

}

util.inherits(Nest, EventEmitter);

module.exports = Nest;
