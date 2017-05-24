'use strict';

const EventEmitter = require('events').EventEmitter;
const util = require('util');
const log = require('./SystemLog2');
const Firebase = require('firebase');
const deepDiff = require('deep-diff').diff;
const LOG_PREFIX = 'NEST';

const STATES = {
  preInit: 'start',
  init: 'init',
  ready: 'ready',
  offline: 'offline',
  error: 'error',
  timeout_exceeded: 'timeout_exceeded',
};

/**
 * Nest API Wrapper
 *
 * @param {string} authToken Auth Token to use
 * @param {Object} fbRef Firebase Root Reference
 */
function Nest(authToken, fbRef) {
  const RETRY_DELAY = 18 * 1000;
  const MAX_DISCONNECT = 5 * 60 * 1000;
  const RECONNECT_TIMEOUT = 1 * 60 * 1000;
  const _self = this;
  let _fbRef;
  let _fbNest;
  let _config = {
    auto: {
      DAY: {
        LR: 70,
        BR: 70,
      },
      SLEEP: {
        LR: 62,
        BR: 62,
      },
    },
    thermostats: {
      BR: 'dQ2cONq2P3NPOgLG6WFYC7X_gKS0QBk1',
      LR: 'dQ2cONq2P3MTSPzuctw3jrX_gKS0QBk1',
    },
  };
  let _disconnectedTimer;
  const _authToken = authToken;
  let _deviceState = 'start';
  let _nestData = {};
  let _structureId;

  this.deviceState = _deviceState;
  this.nestData = _nestData;

  /**
   * Starts the Nest Fan and runs it for the default time period
   *
   * @param {string} roomId Room ID (LR/BR) to adjust
   * @param {Number} minutes Not yet used
   * @return {Boolean} True if the state was successfully changed
   */
  this.runNestFan = function(roomId, minutes) {
    const thermostatId = _findThermostatId(roomId);
    if (!thermostatId) {
      return Promise.reject(new Error('room_id_not_found'));
    }
    return _runHVACFan(thermostatId, minutes);
  };

  /**
   * Sets the Nest status to Away
   *
   * @return {Promise} Resolves to a boolean, with the result of the request
   */
  this.setAway = function() {
    return _setHomeAway('away');
  };

  /**
   * Sets the Nest status to Home
   *
   * @return {Promise} Resolves to a boolean, with the result of the request
   */
  this.setHome = function() {
    return _setHomeAway('home');
  };

  /**
   * Enables all Nest Cameras
   *
   * @param {Boolean} enabled If the camera is enabled or not
   * @return {Promise} Resolves to a boolean, with the result of the request
   */
  this.enableCamera = function(enabled) {
    return _setCamerasStreaming(enabled);
  };

  /**
   * Adjust the temperature in a room by 1 degree
   *
   * @param {string} roomId Room ID (LR/BR) to adjust
   * @param {string} direction Direction to adjust the temp (UP/DOWN)
   * @return {Boolean} True if the state was successfully changed
   */
  this.adjustTemperature = function(roomId, direction) {
    const thermostatId = _findThermostatId(roomId);
    if (!thermostatId) {
      return Promise.reject(new Error('room_id_not_found'));
    }
    const thermostat = _getThermostat(thermostatId);
    if (!thermostat) {
      return Promise.reject(new Error('thermostat_not_found'));
    }
    try {
      direction = direction.toUpperCase();
      let temperature = thermostat['target_temperature_f'];
      temperature = parseInt(temperature, 10);
      if (direction === 'UP' || direction === 'DIM_UP') {
        temperature++;
      } else if (direction === 'DOWN' || direction === 'DIM_DOWN') {
        temperature--;
      } else {
        let msg = 'adjustTemperature failed, unknown direction: ' + direction;
        log.warn(LOG_PREFIX, msg);
      }
      if (temperature > 90 || temperature < 60) {
        log.warn(LOG_PREFIX, 'adjustTemperature failed, limit exceeded.');
        return Promise.reject(new Error('temperature_limit_exceeded'));
      }
      return _setThermostat(thermostatId, temperature);
    } catch (ex) {
      log.exception(LOG_PREFIX, 'adjustTemperature failed', ex);
      return Promise.reject(ex);
    }
  };

  /**
   * Set the temperature in a room to a specific temperature
   *
   * @param {string} roomId Room ID (LR/BR) to adjust
   * @param {Number} temperature Temperature to set the room to
   * @return {Boolean} True if the state was successfully changed
   */
  this.setTemperature = function(roomId, temperature) {
    const thermostatId = _findThermostatId(roomId);
    if (!thermostatId) {
      return Promise.reject(new Error('room_id_not_found'));
    }
    try {
      temperature = parseInt(temperature, 10);
      if (temperature > 90 || temperature < 60) {
        log.warn(LOG_PREFIX, 'setTemperature failed, limit exceeded.');
        return Promise.reject(new Error('temperature_limit_exceeded'));
      }
      return _setThermostat(thermostatId, temperature);
    } catch (ex) {
      log.exception(LOG_PREFIX, 'setTemperature failed', ex);
      return Promise.reject(ex);
    }
  };

  /**
   * Automatically adjust temperature based on config
   *
   * @param {string} value Auto mode to use
   * @return {Boolean} True if the state was successfully changed
   */
  this.setAutoTemperature = function(value) {
    if (!value) {
      return Promise.reject(new Error('invalid_input'));
    }
    try {
      const temperatures = _config.auto[value.toUpperCase()];
      if (!temperatures) {
        let msg = 'setAutoTemperature failed, unable to find settings for: ';
        msg += value;
        log.error(LOG_PREFIX, msg);
        return Promise.reject(new Error('no_settings_for_mode'));
      }
      const keys = Object.keys(temperatures);
      return Promise.all(keys.map((key) => {
        return this.setTemperature(key, temperatures[key]);
      }));
    } catch (ex) {
      log.exception(LOG_PREFIX, 'setAutoTemperature failed', ex);
      return Promise.reject(ex);
    }
  };

  /**
   * Initialize the API
   */
  function _init() {
    log.init(LOG_PREFIX, 'Init');
    if (!authToken) {
      log.error(LOG_PREFIX, 'No Nest authToken provided.');
      _setState(STATES.error, 'No Nest authToken provided.');
    }
    if (!fbRef) {
      log.warn(LOG_PREFIX, 'No Firebase reference provided.');
    }
    if (fbRef) {
      _fbRef = fbRef.child('hvac');
      _fbRef.on('value', function(snapshot) {
        _config = snapshot.val();
      });
    }
    _setState(STATES.init);
    _login();
  }

  /**
   * Log in to the Nest API
   */
  function _login() {
    if (_fbNest) {
      log.error(LOG_PREFIX, 'Already logged in, aborting new login attempt.');
      return;
    }
    log.log(LOG_PREFIX, 'Login');
    _fbNest = new Firebase('https://developer-api.nest.com');
    _fbNest.authWithCustomToken(_authToken, function(err, token) {
      if (err) {
        _setState(STATES.error, err);
        log.exception(LOG_PREFIX, 'Authentication Error', err);
        return;
      }
      _fbNest.once('value', function(snapshot) {
        let data = snapshot.val();
        _nestData = data;
        _structureId = Object.keys(data.structures)[0];
        _setState(STATES.ready, _nestData);
        _self.emit('change', _nestData);
        _initMonitor();
      });
    });
  }

  /**
   * Logs out of the Nest API and clears any variables
   */
  function _logout() {
    log.log(LOG_PREFIX, 'Logout');
    if (!_fbNest) {
      return;
    }
    _setState(STATES.offline, 'Logged out.');
    _fbNest.unauth();
    _fbNest = null;
  }

  /**
   * Watches the Nest API for any data changes.
   *   Fires a change event if data is updated. Also monitors the connection
   *   status and calls onDisconnectTimeoutExceeded if the connection has
   *   been dead too long.
   */
  function _initMonitor() {
    _fbNest.on('value', function(snapshot) {
      const newData = snapshot.val();
      let changes = 0;
      let diff = deepDiff(_nestData, newData);
      if (diff) {
        diff.forEach(function(d) {
          let path = d.path.join('/');
          if (path.indexOf('_url') > 0) {
            return;
          }
          changes++;
        });
      }
      if (changes > 0) {
        _nestData = newData;
        _self.emit('change', _nestData);
      }
    });
    _fbNest.child('.info/connected').on('value', function(snapshot) {
      if (snapshot.val() === true) {
        if (_disconnectedTimer) {
          clearTimeout(_disconnectedTimer);
          _disconnectedTimer = null;
          _setState(STATES.ready);
        }
        return;
      }
      _setState(STATES.offline, 'Lost connection to Nest service.');
      _disconnectedTimer = setTimeout(
        _onDisconnectTimeoutExceeded, MAX_DISCONNECT);
    });
  }

  /**
   * Handle disconnect timeout exceeded
   *   Called when the disconnect timeout counter has been exceeded.
   */
  function _onDisconnectTimeoutExceeded() {
    _disconnectedTimer = null;
    _setState(STATES.timeout_exceeded, 'Disconnect timeout exceeded.');
    _logout();
    setTimeout(_init, RECONNECT_TIMEOUT);
  }

  /**
   * Set the API State
   *   Updates the device state and fires an event to let listeners know the
   *   state has changed.
   *
   * @param {string} newState The new state to
   * @param {string} extra Message to attach to the event
   * @return {Boolean} True if the state was successfully changed
   */
  function _setState(newState, extra) {
    if (_deviceState === newState) {
      log.log(LOG_PREFIX, 'State is already: ' + newState, extra);
      return false;
    }
    _deviceState = newState;
    _self.emit('state', newState, extra);
    let msg = 'State changed to: ' + newState;
    if (extra) {
      if (typeof extra === 'string') {
        msg += ` (${extra})`;
      } else if (extra.message) {
        msg += ` (${extra.message})`;
      }
    }
    if (newState < 0) {
      log.warn(LOG_PREFIX, msg, extra);
      return true;
    }
    log.log(LOG_PREFIX, msg);
    return true;
  }

  /**
   * Post SET debug logger
   *   Called when the Nest Firebase object has been updated.
   *
   * @param {string} path Path used to set the parameter.
   * @param {Object} err Error (if any)
   * @return {Boolean} True if the state was successfully changed
   */
  function _onSetComplete(path, err) {
    if (err) {
      log.exception(LOG_PREFIX, err.message + ' at path: ' + path, err);
      return false;
    } else {
      log.debug(LOG_PREFIX, 'setComplete: ' + path);
      return true;
    }
  }

  /**
   * Get the Nest ThermostatId for the specified roomId
   *
   * @param {string} roomId Room ID to look up.
   * @return {string} thermostatId
   */
  function _findThermostatId(roomId) {
    let msg = 'Unable to find thermostatId';
    if (!roomId) {
      msg += ', roomId not provided.';
      log.error(LOG_PREFIX, msg);
      return null;
    }
    let thermostatId;
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
   *
   * @param {string} thermostatId Thermostat to look up.
   * @return {Object} thermostat
   */
  function _getThermostat(thermostatId) {
    let msg = 'Unable to find thermostat';
    if (!thermostatId) {
      msg += ', thermostatId not provided';
      log.error(LOG_PREFIX, msg);
      return null;
    }
    try {
      let thermostat = _nestData.devices.thermostats[thermostatId];
      return thermostat;
    } catch (ex) {
      msg += ', an exception occured.';
      log.exception(LOG_PREFIX, msg, ex);
      return null;
    }
  }

  /**
   * Sets the Nest Home/Away state
   *
   * @param {string} state The new home state, home/away
   * @return {Promise} A promise that resolves to true/false based on result
   */
  function _setHomeAway(state) {
    return new Promise(function(resolve, reject) {
      if (_deviceState !== STATES.ready) {
        log.error(LOG_PREFIX, 'setHomeAway failed, Nest not ready.');
        reject(new Error('not_ready'));
        return;
      }
      log.log(LOG_PREFIX, `setHomeAway to: ${state}`);
      const path = `structures/${_structureId}/away`;
      _fbNest.child(path).set(state, (err) => {
        resolve(_onSetComplete(path, err));
      });
    });
  }

  /**
   * Sets the Nest Camera streaming state for all cameras.
   *
   * @param {Boolean} state Whether the camera is on or not
   * @return {Promise} A promise that resolves to true/false based on result
   */
  function _setCamerasStreaming(state) {
    if (_deviceState !== STATES.ready) {
      log.error(LOG_PREFIX, 'setCamerasStreaming failed, Nest not ready.');
      return Promise.reject(new Error('not_ready'));
    }
    let cameras = _nestData.structures[_structureId].cameras;
    return Promise.all(cameras.map((cameraId) => {
      const path = `devices/cameras/${cameraId}/is_streaming`;
      const cameraName = _nestData.devices.cameras[cameraId].name;
      log.log(LOG_PREFIX, `setCameraStreamingState (${cameraName}): ${state}`);
      return new Promise(function(resolve, reject) {
        _fbNest.child(path).set(state, (err) => {
          resolve(_onSetComplete(path, err));
        });
      });
    }));
  }

  /**
   * Sets the temperature on the specified thermostat
   *
   * @param {string} thermostatId The thermostat to set
   * @param {Number} temperature Temperature to set it to
   * @param {Boolean} isRetry If the attempt is a retry
   * @return {Boolean} True if it was set successfully
   */
  function _setThermostat(thermostatId, temperature, isRetry) {
    return new Promise(function(resolve, reject) {
      let thermostat = _nestData.devices.thermostats[thermostatId];
      let msg = `setThermostat in ${thermostat.name} to: ${temperature}°F`;
      if (_deviceState !== STATES.ready) {
        log.error(LOG_PREFIX, msg + ' failed, Nest not ready.');
        reject(new Error('not_ready'));
        return;
      }
      let hvacMode = thermostat['hvac_mode'];
      if (hvacMode === 'eco' || hvacMode === 'off') {
        msg += ' aborted, incompatible HVAC mode: ' + hvacMode;
        if (isRetry !== true) {
          msg += '. Will retry.';
          log.log(LOG_PREFIX, msg);
          setTimeout(() => {
            resolve(_setThermostat(thermostatId, temperature, true));
          }, RETRY_DELAY);
        }
        return;
      }
      log.log(LOG_PREFIX, msg);
      const path = `devices/thermostats/${thermostatId}/target_temperature_f`;
      _fbNest.child(path).set(temperature, (err) => {
        resolve(_onSetComplete(path, err));
      });
    });
  }

  /**
   * Starts or stops the Fan
   *
   * @param {String} thermostatId The thermostat to set
   * @param {Number} minutes Only useful for 0 to turn the fan off
   * @param {Boolean} isRetry If the attempt is a retry
   * @return {Boolean} True if it was set successfully
   */
  function _runHVACFan(thermostatId, minutes, isRetry) {
    return new Promise(function(resolve, reject) {
      let thermostat = _nestData.devices.thermostats[thermostatId];
      let msg = 'runHVACFan in ' + thermostat.name;
      if (_deviceState !== STATES.ready) {
        log.error(LOG_PREFIX, msg + ' failed, Nest not ready.');
        reject(new Error('not_ready'));
        return;
      }
      let hvacMode = thermostat['hvac_mode'];
      if (hvacMode === 'eco' || hvacMode === 'off') {
        msg += ' aborted, incompatible HVAC mode: ' + hvacMode;
        if (isRetry !== true) {
          msg += '. Will retry.';
          log.log(LOG_PREFIX, msg);
          setTimeout(() => {
            resolve(_runHVACFan(thermostatId, minutes, true));
          }, RETRY_DELAY);
        }
        return;
      }
      let fanOn = minutes === 0 ? false : true;
      log.log(LOG_PREFIX, msg + ' ' + fanOn);
      const path = `devices/thermostats/${thermostatId}/fan_timer_active`;
      _fbNest.child(path).set(fanOn, (err) => {
        resolve(_onSetComplete(path, err));
      });
    });
  }

  _init();
}

util.inherits(Nest, EventEmitter);

// module.exports = Nest;
exports.Nest = Nest;
exports.STATES = STATES;
