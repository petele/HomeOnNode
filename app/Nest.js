'use strict';

const util = require('util');
const log = require('./SystemLog2');
const Firebase = require('firebase');
const deepDiff = require('deep-diff').diff;
const EventEmitter = require('events').EventEmitter;

const LOG_PREFIX = 'NEST';

const T_01_MIN = 1 * 60 * 1000;
const T_05_MIN = 5 * 60 * 1000;
const T_15_MIN = 10 * 60 * 1000;
const T_22_MIN = 22 * 60 * 1000;
const T_60_MIN = 60 * 60 * 1000;

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
 * @constructor
 *
 * @fires Nest#change
 * @fires Nest#state
 * @property {Object} nestData
 * @param {string} authToken Auth Token to use
 */
function Nest(authToken) {
  const RETRY_DELAY = 18 * 1000;
  const MAX_DISCONNECT = T_05_MIN;
  const RECONNECT_TIMEOUT = T_01_MIN;
  const _self = this;
  const _authToken = authToken;
  let _fbNest;
  let _disconnectedTimer;
  let _deviceState = STATES.preInit;
  let _nestData = {};
  let _structureId;
  let _eta;
  let _etaTimer;

  this.nestData = _nestData;

  /**
   * Starts the Nest Fan and runs it for the default time period
   *
   * @param {string} thermostatId thermostatId to adjust
   * @param {Number} minutes Not yet used
   * @return {Promise} Resolves to a boolean, with the result of the request
   */
  this.runFan = function(thermostatId, minutes) {
    if (!thermostatId) {
      return Promise.reject(new Error('missing_thermostat_id'));
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
    return _setHomeAway('home').then(() => {
      return _cancelETA();
    });
  };

  /**
   * Starts the Nest ETA
   *
   * @param {Number} minutesUntilHome Number of minutes until home.
   * @return {Promise} Resolves to a boolean, with the result of the request.
   */
  this.startETA = function(minutesUntilHome) {
    minutesUntilHome = parseInt(minutesUntilHome, 10);
    if (minutesUntilHome === 0) {
      return _cancelETA();
    } else if (minutesUntilHome > 0 && minutesUntilHome < 90) {
      return _startETA(minutesUntilHome);
    }
    return Promise.reject(new Error('value_out_of_range'));
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
   * @param {string} thermostatId Thermostat ID to adjust
   * @param {string} direction Direction to adjust the temp (UP/DOWN)
   * @return {Promise} Resolves to a boolean, with the result of the request
   */
  this.adjustTemperature = function(thermostatId, direction) {
    let msg = `adjustTemperature('${thermostatId}', '${direction}')`;
    if (_deviceState !== STATES.ready) {
      log.error(LOG_PREFIX, msg + ' failed, Nest not ready.');
      return Promise.reject(new Error('not_ready'));
    }
    if (!thermostatId) {
      return Promise.reject(new Error('missing_thermostat_id'));
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
        msg += ' failed, unknown direction.';
        log.warn(LOG_PREFIX, msg);
        return Promise.reject(new Error('unknown_direction'));
      }
      if (temperature > 90 || temperature < 60) {
        log.warn(LOG_PREFIX, msg + ' failed, limit exceeded.');
        return Promise.reject(new Error('temperature_limit_exceeded'));
      }
      return _setThermostat(thermostatId, temperature);
    } catch (ex) {
      log.exception(LOG_PREFIX, msg + ' failed', ex);
      return Promise.reject(ex);
    }
  };

  /**
   * Set the temperature in a room to a specific temperature
   *
   * @param {string} thermostatId Thermostat ID to adjust
   * @param {Number} temperature Temperature to set the room to
   * @return {Promise} Resolves to a boolean, with the result of the request
   */
  this.setTemperature = function(thermostatId, temperature) {
    if (!thermostatId) {
      return Promise.reject(new Error('missing_thermostat_id'));
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
   * Initialize the API
   */
  function _init() {
    log.init(LOG_PREFIX, 'Starting...');
    if (!authToken) {
      const msg = 'No Nest authToken provided.';
      log.error(LOG_PREFIX, msg);
      _setState(STATES.error, msg);
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
    log.debug(LOG_PREFIX, 'Authenticating...');
    _fbNest = new Firebase('https://developer-api.nest.com');
    _fbNest.authWithCustomToken(_authToken, function(err, token) {
      if (err) {
        _setState(STATES.error, err);
        log.exception(LOG_PREFIX, 'Authentication Error', err);
        return;
      }
      log.debug(LOG_PREFIX, 'Authenticated.');
      _fbNest.once('value', function(snapshot) {
        const data = snapshot.val();
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
      const diff = deepDiff(_nestData, newData);
      if (diff) {
        diff.forEach(function(d) {
          const path = d.path.join('/');
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
      log.warn(LOG_PREFIX, 'State is already: ' + newState, extra);
      return false;
    }
    _deviceState = newState;
    _self.emit('state', newState, extra);
    let msg = `setState('${newState}')`;
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
    log.debug(LOG_PREFIX, msg);
    return true;
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
      const thermostat = _nestData.devices.thermostats[thermostatId];
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
      const msg = `setHomeAway('${state}')`;
      if (_deviceState !== STATES.ready) {
        log.error(LOG_PREFIX, msg + ' failed, Nest not ready.');
        reject(new Error('not_ready'));
        return;
      }
      log.debug(LOG_PREFIX, msg);
      const path = `structures/${_structureId}/away`;
      _fbNest.child(path).set(state, (err) => {
        if (err) {
          log.error(LOG_PREFIX, `${msg} FB write failed.`, err);
          reject(err);
          return;
        }
        log.verbose(LOG_PREFIX, path, state);
        resolve(true);
      });
    });
  }

  /**
   * Starts the ETA timer.
   * @param {Number} minutesUntilHome
   * @return {Promise}
   */
  function _startETA(minutesUntilHome) {
    const now = Date.now();
    const name = `eta-${minutesUntilHome}`;
    const msg = `startETA('${name}', ${minutesUntilHome})`;
    if (_eta || _etaTimer) {
      log.error(LOG_PREFIX, `${msg} failed, ETA already set.`);
      return Promise.reject(new Error('eta_already_set'));
    }
    // TODO uncomment me
    // if (_nestData.structures[_structureId].away === 'home') {
    //   log.warn(LOG_PREFIX, `${msg} failed, state is already home.`);
    //   return Promise.reject(new Error('already_home'));
    // }
    const start = now + (minutesUntilHome * 60 * 1000);
    const end = start + T_22_MIN;
    const max = start + T_60_MIN;
    _eta = {name, start, end, max};
    log.log(LOG_PREFIX, msg, _eta);
    _scheduleETAUpdate();
    return _updateETA();
  }

  /**
   * Cancels the existing ETA Timer
   *
   * @return {Promise} Boolean, always true.
   */
  function _cancelETA() {
    log.log(LOG_PREFIX, 'cancelETA');
    if (_etaTimer) {
      clearTimeout(_etaTimer);
      _etaTimer = null;
    }
    if (_eta) {
      return _updateETA(true)
          .catch(() => {
            // Ignore we've already logged the error.
          })
          .then(() => {
            _eta = null;
            return true;
          });
    }
    return Promise.resolve(true);
  }

  /**
   * Schedules an update to the ETA time.
   */
  function _scheduleETAUpdate() {
    // Is there a timer already scheduled?
    if (_etaTimer) {
      log.error(LOG_PREFIX, `_scheduleETAUpdate: etaTimer already scheduled.`);
      return;
    }
    // Is ETA available?
    if (!_eta) {
      log.error(LOG_PREFIX, `scheduleETAUpdate: failed, _eta unavailable.`);
      return;
    }
    log.verbose(LOG_PREFIX, `scheduleETAUpdate: scheduled (5 minutes).`);
    _etaTimer = setTimeout(() => {
      _etaTimer = null;
      // Is the state in home? If so, cancel
      if (_nestData.structures[_structureId].away === 'home') {
        log.warn(LOG_PREFIX, `scheduledETAUpdate: stopped, state is 'home'`);
        return _cancelETA();
      }
      // Have we exceeded the maximum time?
      if (Date.now() > _eta.max) {
        log.warn(LOG_PREFIX, `scheduleETAUpdate: max time exceeded.`);
        return _cancelETA();
      }
      _updateETA().then(() => {
        _scheduleETAUpdate();
      });
    }, T_05_MIN);
  }

  /**
   * Updates the Nest ETA information
   *
   * @param {Boolean} clearETA true if you want to clear the existing ETA.
   * @return {Promise} Boolean true if the ETA was updated/set.
   */
  function _updateETA(clearETA) {
    return new Promise((resolve, reject) => {
      const msg = clearETA ? `updateETA(true)` : `updateETA()`;
      const now = Date.now();
      let start = _eta.start;
      if (now > start) {
        start = now;
      }
      let end = _eta.end;
      if ((now + T_05_MIN) > end) {
        end = end + T_15_MIN;
      }
      const eta = {
        trip_id: _eta.name,
      };
      if (clearETA) {
        eta.estimated_arrival_window_begin = 0;
        eta.estimated_arrival_window_end = 0;
      } else {
        eta.estimated_arrival_window_begin = new Date(start).toISOString();
        eta.estimated_arrival_window_end = new Date(end).toISOString();
      }
      const path = `structures/${_structureId}/eta`;
      log.debug(LOG_PREFIX, msg, eta);
      _fbNest.child(path).set(eta, (err) => {
        if (err) {
          log.error(LOG_PREFIX, `${msg} failed.`, err);
          log.verbose(LOG_PREFIX, msg, eta);
          return reject(err);
        }
        log.verbose(LOG_PREFIX, path, eta);
        return resolve(true);
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
    const msg = `setCameraStreamingState(${state})`;
    if (_deviceState !== STATES.ready) {
      log.error(LOG_PREFIX, msg + ' failed, Nest not ready.');
      return Promise.reject(new Error('not_ready'));
    }
    const cameras = _nestData.structures[_structureId].cameras;
    return Promise.all(cameras.map((cameraId) => {
      const path = `devices/cameras/${cameraId}/is_streaming`;
      log.debug(LOG_PREFIX, msg);
      return new Promise(function(resolve, reject) {
        _fbNest.child(path).set(state, (err) => {
          if (err) {
            log.error(LOG_PREFIX, `${msg} FB write failed.`, err);
            reject(err);
            return;
          }
          log.verbose(LOG_PREFIX, path, state);
          resolve(true);
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
      let msg = `setThermostat('${thermostatId}', ${temperature})`;
      if (_deviceState !== STATES.ready) {
        log.error(LOG_PREFIX, msg + ' failed, Nest not ready.');
        reject(new Error('not_ready'));
        return;
      }
      const thermostat = _getThermostat(thermostatId);
      if (!thermostat) {
        reject(new Error('thermostat_not_found'));
        return;
      }
      const hvacMode = thermostat['hvac_mode'];
      if (hvacMode === 'eco' || hvacMode === 'off') {
        msg += ' aborted, incompatible HVAC mode: ' + hvacMode;
        if (isRetry !== true) {
          msg += '. Will retry.';
          log.warn(LOG_PREFIX, msg);
          setTimeout(() => {
            resolve(_setThermostat(thermostatId, temperature, true));
          }, RETRY_DELAY);
          return;
        }
        log.warn(LOG_PREFIX, msg);
        reject(new Error('incompatible_hvac_mode'));
        return;
      }
      log.debug(LOG_PREFIX, msg);
      const path = `devices/thermostats/${thermostatId}/target_temperature_f`;
      _fbNest.child(path).set(temperature, (err) => {
        if (err) {
          if (isRetry) {
            log.error(LOG_PREFIX, `${msg} FB write failed.`, err);
            reject(err);
            return;
          }
          log.warn(LOG_PREFIX, `${msg} FB write failed, will retry.`, err);
          setTimeout(() => {
            resolve(_setThermostat(thermostatId, temperature, true));
          }, RETRY_DELAY);
          return;
        }
        log.verbose(LOG_PREFIX, path, temperature);
        resolve(true);
      });
    });
  }

  /**
   * Starts or stops the Fan
   *
   * @param {String} thermostatId The thermostat to set
   * @param {Number} minutes Only useful for 0 to turn the fan off
   * @param {Boolean} isRetry If the attempt is a retry
   * @return {Promise} Resolves to a boolean, with the result of the request
   */
  function _runHVACFan(thermostatId, minutes, isRetry) {
    return new Promise(function(resolve, reject) {
      const msg = `runHVACFan('${thermostatId}', ${minutes}, ${isRetry})`;
      if (_deviceState !== STATES.ready) {
        log.error(LOG_PREFIX, msg + ' failed, Nest not ready.');
        reject(new Error('not_ready'));
        return;
      }
      const thermostat = _getThermostat(thermostatId);
      if (!thermostat) {
        log.error(LOG_PREFIX, msg + ' failed, thermostat not found.');
        reject(new Error('thermostat_not_found'));
        return;
      }
      const FAN_TIMES = [0, 15, 30, 45, 60, 120, 240, 480, 720];
      if (FAN_TIMES.indexOf(minutes) === -1) {
        log.error(LOG_PREFIX, msg + ' failed, invalid fan timer length.');
        reject(new Error('invalid_fan_time'));
        return;
      }
      log.debug(LOG_PREFIX, `runHVACFan('${thermostat.name}', ${minutes})`);
      const opts = {
        fan_timer_active: true,
      };
      if (minutes === 0) {
        opts.fan_timer_active = false;
      } else {
        opts.fan_timer_duration = minutes;
      }
      const path = `devices/thermostats/${thermostatId}/`;
      _fbNest.child(path).update(opts, (err) => {
        if (err) {
          log.error(LOG_PREFIX, `${msg} FB write failed.`, err);
          reject(err);
          return;
        }
        log.verbose(LOG_PREFIX, path, opts);
        resolve(true);
      });
    });
  }

  _init();
}

util.inherits(Nest, EventEmitter);

// module.exports = Nest;
exports.Nest = Nest;
exports.STATES = STATES;
