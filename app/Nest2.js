'use strict';

var EventEmitter = require('events').EventEmitter;
var util = require('util');
var log = require('./SystemLog2');
var Firebase = require('firebase');
var diff = require('deep-diff').diff;
var LOG_PREFIX = 'NEST';

var STATES = { preInit: 0, init: 1, ready: 10, offline: -1, error: -10 };

/**
 * Nest API Wrapper
 *
 * @param {string} authToken Auth Token to use
 * @param {Object} fbRef Firebase Root Reference
 * @return {Object} The Nest API Object
 */
function Nest(authToken, fbRef) {
  
  var MAX_DISCONNECT = 5 * 60 * 1000;
  var RECONNECT_TIMEOUT = 1 * 60 * 1000;
  var _fbRef;
  var _fbNest;
  var _config = {
    auto: {
      DAY: {
        LR: 70,
        BR: 70
      },
      SLEEP: {
        LR: 62,
        BR: 62
      }
    },
    thermostats: {
      BR: 'dQ2cONq2P3NPOgLG6WFYC7X_gKS0QBk1',
      LR: 'dQ2cONq2P3MTSPzuctw3jrX_gKS0QBk1'
    }
  }
  var _reconnectTimer;
  var _disconnectedTimer;
  var _authToken = authToken;
  var _self = this;

  /*****************************************************************************
   * Public Properties and Methods
   ****************************************************************************/
  this.deviceId = 'Nest';
  this.deviceState = STATES.preInit;
  this.nestData = {};
  this.structureId;

  /**
   * Sets the Nest status to Away
   */
  this.setAway = function() {
    return setHomeAway('away');
  }

  /**
   * Sets the Nest status to Home
   */
  this.setHome = function() {
    return setHomeAway('home');
  }

  /**
   * Enables all Nest Cameras
   */
  this.enableCamera = function() {
    return setCamerasStreaming(true);
  }

  /**
   * Disables all Nest Cameras
   */
  this.disableCamera = function() {
    return setCamerasStreaming(false);
  }

  /**
   * Adjust the temperature in a room by 1 degree
   *
   * @param {string} roomId Room ID (LR/BR) to adjust
   * @param {string} direction Direction to adjust the temp (UP/DOWN)
   * @return {Boolean} True if the state was successfully changed
   */
  this.adjustTemperature = function(roomId, direction) {
    var thermostatId = findThermostatId(roomId);
    if (!thermostatId) {
      return false;
    }
    var thermostat = getThermostat(thermostatId);
    if (!thermostat) {
      return false;
    }
    try {
      direction = direction.toUpperCase();
      var temperature = thermostat['target_temperature_f'];
      temperature = parseInt(temperature, 10);
      if (direction === 'UP' || direction === 'DIM_UP') {
        temperature++;
      } else {
        temperature--;
      }
      if (temperature > 90 || temperature < 60) {
        log.warn(LOG_PREFIX, 'adjustTemperature failed, limit exceeded.');
        return false;
      }
      return setThermostat(thermostatId, temperature);
    } catch (ex) {
      log.exception(LOG_PREFIX, 'adjustTemperature failed', ex);
      return false;
    }
  }

  /**
   * Set the temperature in a room to a specific temperature
   *
   * @param {string} roomId Room ID (LR/BR) to adjust
   * @param {Number} temperature Temperature to set the room to
   * @return {Boolean} True if the state was successfully changed
   */
  this.setTemperature = function(roomId, temperature) {
    var thermostatId = findThermostatId(roomId);
    if (!thermostatId) {
      return false;
    }
    try {
      temperature = parseInt(temperature, 10);
      if (temperature > 90 || temperature < 60) {
        log.warn(LOG_PREFIX, 'setTemperature failed, limit exceeded.');
        return false;
      }
      return setThermostat(thermostatId, temperature);
    } catch (ex) {
      log.exception(LOG_PREFIX, 'setTemperature failed', ex);
      return false;
    }
  }

  /**
   * Automatically adjust temperature based on config
   *
   * @param {string} value Auto mode to use
   * @return {Boolean} True if the state was successfully changed
   */
  this.setAutoTemperature = function(value) {
    if (!value) {
      return false;
    }
    try {
      var temperatures = _config.auto[value.toUpperCase()];
      if (!temperatures) {
        var msg = 'setAutoTemperature failed, unable to find settings for: ';
        msg += value;
        log.error(LOG_PREFIX, msg);
        return false;
      }
      var keys = Object.keys(temperatures);
      keys.forEach(function(key) {
        _self.setTemperature(key, temperatures[key]);
      });
      return true;
    } catch (ex) {
      log.exception(LOG_PREFIX, 'setAutoTemperature failed', ex);
      return false;
    }
  }

  /**
   * Starts the Nest Fan and runs it for the default time period
   *
   * @param {string} roomId Room ID (LR/BR) to adjust
   * @param {Number} minutes Not yet used
   * @return {Boolean} True if the state was successfully changed
   */
  this.runNestFan = function(roomId, minutes) {
    var thermostatId = findThermostatId(roomId);
    if (!thermostatId) {
      return false;
    }
    return runHVACFan(thermostatId, minutes);
  }

  /*****************************************************************************
   * Private Internal Helper Functions
   ****************************************************************************/
  
  /**
   * Initialize the API
   */
  function init() {
    log.init(LOG_PREFIX, 'Init');
    _reconnectTimer = null;
    _disconnectedTimer = null;
    // TODO: Re-enable
    /*
    _fbRef = fbRef.child('hvac');
    _fbRef.on('value', function(snapshot) {
      _config = snapshot.val();
    });
    */
    setState(STATES.init);
    login();
  }

  /**
   * Updates the device state and fires an event to let listeners know the
   * state has changed.
   *
   * @param {string} newState The new state to
   * @param {string} extra Message to attach to the event
   * @return {Boolean} True if the state was successfully changed
   */
  function setState(newState, extra) {
    if (_self.deviceState === newState) {
      log.warn(LOG_PREFIX, 'State is already: ' + newState, msg);
      return false;
    }
    _self.deviceState = newState;
    _self.emit('state', newState, extra);
    var msg = 'State changed to: ' + newState;
    if (newState < 0) {
      log.warn(LOG_PREFIX, msg, extra);  
      return true;
    }
    log.log(LOG_PREFIX, msg, extra);
    return true;
  }

  /**
   * Logs into the Nest API
   */
  function login() {
    if (_fbNest) {
      log.error(LOG_PREFIX, 'Already logged in, aborting new login attempt.');
      return;
    }
    log.log(LOG_PREFIX, 'Login');
    _fbNest = new Firebase('https://developer-api.nest.com');
    _fbNest.authWithCustomToken(_authToken, function(err, token) {
      if (err) {
        setState(STATES.error, err);
        log.exception(LOG_PREFIX, 'Authentication Error', err);
        return;
      }
      _fbNest.once('value', function(snapshot) {
        var data = snapshot.val();
        _self.nestData = data;
        _self.structureId = Object.keys(data.structures)[0];
        setState(STATES.ready, _self.nestData);
        initMonitor();
      });
      
    });
  }

  /**
   * Logs out of the Nest API and clears any variables
   */
  function logout() {
    log.log(LOG_PREFIX, 'Logout');
    if (!_fbNest) {
      return;
    }
    setState(STATES.offline, 'Logged out.');
    _fbNest.unauth();
    _fbNest = null;
  }

  /**
   * Watches the Nest API for any data changes. Fires a change event
   * if data is updated. Also monitors the connection status and calls
   * onDisconnectTimeoutExceeded if the connection has been dead too long.
   */
  function initMonitor() {
    _fbNest.on('value', function(snapshot) {
      var newData = snapshot.val();
      var changes = 0;
      diff(_self.nestData, newData).forEach(function(d) {
        var path = d.path.join('/');
        if (path.indexOf('_url') > 0) {
          return;
        }
        changes++
        // var xtra = {L: d.lhs, R: d.rhs};
        // log.debug(LOG_PREFIX, 'D: ' + path, xtra);
      });
      if (changes > 0) {
        _self.nestData = newData;
        _self.emit('change', _self.nestData);
      }
    });
    _fbNest.child('.info/connected').on('value', function(snapshot) {
      if (snapshot.val() === true) {
        if (_disconnectedTimer) {
          clearTimeout(_disconnectedTimer);
          _disconnectedTimer = null;
          setState(STATES.ready);
        }
        return;
      }
      setState(STATES.offline, 'Lost connection to Nest service.');
      _disconnectedTimer = setTimeout(onDisconnectTimeoutExceeded, MAX_DISCONNECT);
    });
  }

  /**
   * Called when the disconnect timeout counter has been exceeded.
   */
  function onDisconnectTimeoutExceeded() {
    _disconnectedTimer = null;
    setState(STATES.error, 'Disconnect timeout exceeded.');
    logout();
    _reconnectTimer = setTimeout(init, RECONNECT_TIMEOUT);
  }

  /**
   * Called when the Nest Firebase object has been updated.
   * @param {string} path Path used to set the parameter (used in logging)
   * @param {Object} err Error (if any)
   * @return {Boolean} True if the state was successfully changed
   */
  function onSetComplete(path, err) {
    if (err) {
      log.exception(LOG_PREFIX, err.message + ' at path: ' + path, err);
    } else {
      log.debug(LOG_PREFIX, 'setComplete: ' + path);
    }
  }

  /**
   * Finds the Nest ThermostatId for the specified roomId
   * @param {string} roomId Room ID to look up.
   * @return {string} thermostatId
   */
  function findThermostatId(roomId) {
    var msg = 'Unable to find thermostatId';
    if (!roomId) {
      msg += ', roomId not provided.';
      log.error(LOG_PREFIX, msg);
      return null;
    }
    var thermostatId;
    try {
      thermostatId = _config.thermostats[roomId];
    } catch (ex) {
      log.exception(LOG_PREFIX, msg, ex);
      return null;
    }
    if (thermostatId) {
      return thermostatId;
    }
    msg += ' for roomId: ' + roomId;
    log.error(LOG_PREFIX, msg);
    return null;
  }

  /**
   * Finds the Nest Thermostat for the specified thermostatId
   * @param {string} thermostatId Thermostat to look up.
   * @return {Object} thermostat
   */
  function getThermostat(thermostatId) {
    var msg = 'Unable to find thermostat';
    if (!thermostatId) {
      msg += ', thermostatId not provided';
      log.error(LOG_PREFIX, msg);
      return null;
    }
    try {
      var thermostat = _self.nestData.devices.thermostats[thermostatId];
      return thermostat;
    } catch (ex) {
      msg += ', an exception occured.';
      log.exception(LOG_PREFIX, msg, ex);
      return null;
    }
  }

  /**
   * Sets the Nest Home/Away state
   * @param {string} state The new home state, home/away
   * @return {Boolean} True if the state was successfully changed
   */
  function setHomeAway(state) {
    if (_self.deviceState !== STATES.ready) {
      log.error(LOG_PREFIX, 'setHomeAway failed, Nest not ready.');
      return false;
    }
    log.log(LOG_PREFIX, 'setHomeAway to: ' + state);
    var path = 'structures/' + _self.structureId + '/away';
    _fbNest.child(path).set(state, function(err) {
      onSetComplete(path, err);
    });
    return true;
  }

  /**
   * Sets the Nest Camera streaming state for all cameras.
   * @param {Boolean} state Whether the camera is on or not
   * @return {Boolean} True if the state was successfully changed
   */
  function setCamerasStreaming(state) {
    if (_self.deviceState !== STATES.ready) {
      log.error(LOG_PREFIX, 'setCamerasStreaming failed, Nest not ready.');
      return false;
    }
    var cameras = _self.nestData.structures[_self.structureId].cameras;
    cameras.forEach(function(cameraId) {
      var path = 'devices/cameras/' + cameraId + '/is_streaming';
      var cameraName = _self.nestData.devices.cameras[cameraId].name;
      log.log(LOG_PREFIX, 'setCameraStreamingState (' + cameraName + '): ' + state);
      _fbNest.child(path).set(state, function(err) {
        onSetComplete(path, err);
      });
    });
    return true;
  }

  /**
   * Sets the temperature on the specified thermostat
   * @param {string} thermostatId The thermostat to set
   * @param {Number} temperature Temperature to set it to
   * @return {Boolean} True if it was set successfully
   */
  function setThermostat(thermostatId, temperature) {
    var thermostat = _self.nestData.devices.thermostats[thermostatId];
    var msg = 'setThermostat in ' + thermostat.name + ' to: ';
    msg += temperature + '°F';
    if (_self.deviceState !== STATES.ready) {
      log.error(LOG_PREFIX, msg + ' failed, Nest not ready.');
      return false;
    }
    log.log(LOG_PREFIX, msg)
    var path = 'devices/thermostats/' + thermostatId + '/target_temperature_f';
    _fbNest.child(path).set(temperature, function(err) {
      onSetComplete(path, err);
    });
    return true;
  }

  /**
   * Starts or stops the Fan
   * @param {string} thermostatId The thermostat to set
   * @param {Number} minutes Only useful for 0 to turn the fan off
   * @return {Boolean} True if it was set successfully
   */
  function runHVACFan(thermostatId, minutes) {
    var thermostat = _self.nestData.devices.thermostats[thermostatId];
    var msg = 'runHVACFan in ' + thermostat.name;
    if (_self.deviceState !== STATES.ready) {
      log.error(LOG_PREFIX, msg + ' failed, Nest not ready.');
      return false;
    }
    var fanOn = true;
    if (minutes === 0) {
      fanOn = false;
      msg += ' - OFF';
    }
    var path = 'devices/thermostats/' + thermostatId + '/fan_timer_active';
    _fbNest.child(path).set(fanOn, function(err) {
      onSetComplete(path, err);
    });
    return true;
  }

  if (!authToken) {
    log.error(LOG_PREFIX, 'No Nest authToken provided.');
    setState(STATES.error);
    return null;
  }
  if (!fbRef) {
    log.error(LOG_PREFIX, 'No Firebase reference provided.');
    setState(STATES.error);
    return null;
  }
  init();
  return this;
}

util.inherits(Nest, EventEmitter);

// module.exports = Nest;
exports.Nest = Nest;
exports.STATES = STATES;
