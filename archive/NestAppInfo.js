const Nest = require('./Nest');
const HVACUsage = require('./HVACUsage');

// from execCommand
    // Update HVAC Usage
    if (action.hasOwnProperty('hvacUsage')) {
      if (!hvacUsage) {
        log.error(LOG_PREFIX, 'HVAC Usage unavailable.', action);
        return _genResult(action, false, 'not_available');
      }

      const forDay = action.hvacUsage.forDay;
      return hvacUsage.generateSummaryForDay(forDay)
          .then((result) => {
            return _genResult(action, true, result);
          })
          .catch((err) => {
            log.verbose(LOG_PREFIX, `Whoops: hvacUsage failed.`, err);
            return _genResult(action, false, err);
          });
    }
    // Nest Cam
    if (action.hasOwnProperty('nestCam')) {
      if (!nest) {
        log.warn(LOG_PREFIX, 'Nest unavailable.');
        return _genResult(action, false, 'not_available');
      }

      return nest.enableCamera(action.nestCam)
          .then((result) => {
            return _genResult(action, true, result);
          })
          .catch((err) => {
            log.verbose(LOG_PREFIX, `Whoops: nestCam failed.`, err);
            return _genResult(action, false, err);
          });
    }

    // Nest ETA
    if (action.hasOwnProperty('nestETA')) {
      if (!nest) {
        log.warn(LOG_PREFIX, 'Nest unavailable.');
        return _genResult(action, false, 'not_available');
      }

      return nest.startETA(action.nestETA)
          .then((result) => {
            return _genResult(action, true, result);
          })
          .catch((err) => {
            log.verbose(LOG_PREFIX, `Whoops: nestETA failed.`, err);
            return _genResult(action, false, err);
          });
    }

    // Nest Fan
    if (action.hasOwnProperty('nestFan')) {
      if (!nest) {
        log.warn(LOG_PREFIX, 'Nest unavailable.');
        return _genResult(action, false, 'not_available');
      }

      const thermostatId = _getThermostatId(action.nestFan);
      if (!thermostatId) {
        log.warn(LOG_PREFIX, 'Thermostat or Room ID not found.', action);
        return _genResult(action, false, 'no_id_provided');
      }
      const minutes = action.nestFan.minutes;
      return nest.runFan(thermostatId, minutes)
          .then((result) => {
            return _genResult(action, true, result);
          })
          .catch((err) => {
            log.verbose(LOG_PREFIX, `Whoops: nestFan failed.`, err);
            return _genResult(action, false, err);
          });
    }

    // Nest State
    if (action.hasOwnProperty('nestState')) {
      if (!nest) {
        log.warn(LOG_PREFIX, 'Nest unavailable.');
        return _genResult(action, false, 'not_available');
      }

      if (action.nestState === 'HOME') {
        return nest.setHome()
            .then((result) => {
              return _genResult(action, true, result);
            })
            .catch((err) => {
              log.verbose(LOG_PREFIX, `Whoops: nestState failed.`, err);
              return _genResult(action, false, err);
            });
      }

      if (action.nestState === 'AWAY') {
        return nest.setAway()
            .then((result) => {
              return _genResult(action, true, result);
            })
            .catch((err) => {
              log.verbose(LOG_PREFIX, `Whoops: nestState failed.`, err);
              return _genResult(action, false, err);
            });
      }
      log.warn(LOG_PREFIX, `Invalid nestState: ${action.nestState}`);
      return _genResult(action, false, 'invalid_state');
    }

    // Nest Thermostat
    if (action.hasOwnProperty('nestThermostat')) {
      if (!nest) {
        log.warn(LOG_PREFIX, 'Nest unavailable.');
        return _genResult(action, false, 'not_available');
      }
      const thermostatId = _getThermostatId(action.nestThermostat);
      if (!thermostatId) {
        log.warn(LOG_PREFIX, 'Thermostat or Room ID not found.', action);
        return _genResult(action, false, 'no_id_provided');
      }

      if (action.nestThermostat.temperature) {
        const temperature = action.nestThermostat.temperature;
        return nest.setTemperature(thermostatId, temperature)
            .then((result) => {
              return _genResult(action, true, result);
            })
            .catch((err) => {
              log.verbose(LOG_PREFIX, `Whoops: nestThermostat failed.`, err);
              return _genResult(action, false, err);
            });
      }

      if (action.nestThermostat.adjust) {
        const direction = action.nestThermostat.adjust;
        return nest.adjustTemperature(thermostatId, direction)
            .then((result) => {
              return _genResult(action, true, result);
            })
            .catch((err) => {
              log.verbose(LOG_PREFIX, `Whoops: nestThermostat failed.`, err);
              return _genResult(action, false, err);
            });
      }

      log.warn(LOG_PREFIX, `Invalid nestThermostat command.`, action);
      return _genResult(action, false, 'invalid_command');
    }

    // Nest Auto Thermostat
    if (action.hasOwnProperty('nestThermostatAuto')) {
      if (!nest) {
        log.warn(LOG_PREFIX, 'Nest unavailable.');
        return _genResult(action, false, 'not_available');
      }

      const autoMode = action.nestThermostatAuto;
      if (!autoMode) {
        log.warn(LOG_PREFIX, `Nest auto mode '${autoMode}' not found.`);
        return _genResult(action, false, 'auto_mode_not_found');
      }

      const rooms = _config.nest.hvacAuto[autoMode];
      if (typeof rooms !== 'object') {
        log.warn(LOG_PREFIX, `No rooms provided for nestAutoMode`, action);
        return _genResult(action, false, 'no_rooms_provided');
      }

      const results = [];
      Object.keys(rooms).forEach((roomId) => {
        const thermostatId = _getThermostatId({roomId: roomId});
        if (!thermostatId) {
          log.warn(LOG_PREFIX, 'Thermostat or Room ID not found.', action);
          result.push(_genResult(action, false, 'no_id_provided'));
          return;
        }
        const temperature = rooms[roomId];
        const result = nest.setTemperature(thermostatId, temperature)
            .catch((err) => {
              log.verbose(LOG_PREFIX, `Oops: nestThermostatAuto failed.`, err);
              return _genResult(action, false, err);
            });
        results.push(result);
      });
      return Promise.all(results)
          .then((result) => {
            return _genResult(action, true, result);
          });
    }


/** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** **
   *
   * Nest API
   *
   ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** **/

  /**
   * Init Nest
   */
  function _initNest() {
    _fbSet('state/nest', false);

    if (_config.nest.disabled === true) {
      log.warn(LOG_PREFIX, 'Nest disabled via config.');
      return;
    }

    const apiKey = _config.nest.key;
    if (!apiKey) {
      log.error(LOG_PREFIX, `Nest unavailable, no API key available.`);
      return;
    }
    nest = new Nest.Nest(apiKey);
    nest.on('change', (data) => {
      _fbSet('state/nest', data);
    });

    try {
      hvacUsage = new HVACUsage(_fb);
    } catch (ex) {
      const msg = `Unable to initialize hvacUsage`;
      log.exception(LOG_PREFIX, msg, ex);
    }

    nest.on('hvacStateChanged', (data) => {
      const key = data.date;
      const startDate = moment(key).format('YYYY-MM-DD');
      const roomName = _config.nest.thermostats[data.key];
      const path = `logs/hvacUsage/events/${startDate}/${roomName}/${key}`;
      _fbSet(path, data.mode);
      if (hvacUsage) {
        hvacUsage.generateSummaryForDay();
      }
    });

    nest.on('hvacTempChanged', (data) => {
      const key = data.date;
      const startDate = moment(key).format('YYYY-MM-DD');
      const roomName = _config.nest.thermostats[data.key];
      const path = `logs/hvacUsage/events/${startDate}` +
                   `/setTemp/${roomName}/${key}`;
      _fbSet(path, data.temp);
    });
  }

  /**
   * Parses a Nest Action Object and gets the thermostat ID.
   *
   * @param {Object} nestAction
   * @return {!String}
   */
  function _getThermostatId(nestAction) {
    if (nestAction.thermostatId) {
      return nestAction.thermostatId;
    }
    if (nestAction.roomId) {
      return _config.nest.thermostats[nestAction.roomId];
    }
    return null;
  }