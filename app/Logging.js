'use strict';

const log = require('./SystemLog2');
const FBHelper = require('./FBHelper');

/**
 * Logging API.
 * @constructor
*/
function Logging() {
  const LOG_PREFIX = 'LOGGING';
  let _fbRef;

  /**
   * Initialize the API
   */
  function _init() {
    FBHelper.getRootRefUnlimited()
        .then((fbRootRef) => {
          return fbRootRef.child('logs/cron');
        })
        .then((fbRef) => {
          _fbRef = fbRef;
        });
  }

  /**
   * Creates and saves the current state.
   *
   * @param {Object} state The current systemState
   */
  this.saveData = function(state) {
    log.debug(LOG_PREFIX, 'saveData');
    if (!_fbRef) {
      log.error(LOG_PREFIX, 'Firebase root not set.');
      return;
    }
    if (!state || typeof state !== 'object') {
      log.error(LOG_PREFIX, `Invalid 'state' object provided.`, state);
      return;
    }

    const now = Date.now();
    const nowPretty = log.formatTime(now);
    const value = {
      date: now,
      date_: nowPretty,
    };

    // Store system state.
    if (state.systemState) {
      value.systemState = state.systemState;
    }

    // Store weather data.
    if (state.weather && state.weather.now) {
      value.weather = _getWeather(state.weather.now);
    }

    // Store the Harmony data.
    if (state.harmony && state.harmony.activity) {
      value.harmonyActivity = _getHarmonyActivity(state.harmony.activity);
    }

    // Store the Nest data
    if (state.nest && state.nest.devices) {
      // Store the Nest Thermostat data.
      if (state.nest.devices.thermostats) {
        value.thermostats = _getNestThermostats(state.nest.devices.thermostats);
      }
      // Store the Nest Protect data.
      if (state.nest.devices.smoke_co_alarms) {
        value.protect = _getNestProtects(state.nest.devices.smoke_co_alarms);
      }
    }

    // Store presence data.
    if (state.presence && state.presence.people) {
      value.presence = _getPresence(state.presence.people);
    }

    // Store Awair data.
    if (state.awair && state.awair.local) {
      const br = _getAwairData(state.awair.local.BR);
      const lr = _getAwairData(state.awair.local.LR);
      if (br || lr) {
        value.awair = {};
        if (br) {
          value.awair.BR = br;
        }
        if (lr) {
          value.awair.LR = lr;
        }
      }
    }

    // Store Hue sensor data.
    if (state.hue && state.hue.sensors) {
      const result = {};
      const sensors = state.hue.sensors;
      if (sensors[10] && sensors[11] && sensors[12]) {
        result.BA = _getHueSensorData(state.hue.sensors, 10, 11, 12);
      }
      if (sensors[29] && sensors[30] && sensors[31]) {
        result.BR = _getHueSensorData(state.hue.sensors, 31, 29, 30);
      }
      if (sensors[27] && sensors[25] && sensors[26]) {
        result.LR = _getHueSensorData(state.hue.sensors, 27, 25, 26);
      }
      if (Object.keys(result).length > 0) {
        value.hueData = result;
      }
    }

    try {
      _fbRef.push(value, (err) => {
        if (err) {
          log.exception(LOG_PREFIX, 'Error saving to Firebase [1]', err);
          return;
        }
        log.verbose(LOG_PREFIX, 'Logging Data saved', value);
      });
    } catch (ex) {
      log.exception(LOG_PREFIX, 'Error saving to Firebase [2]', ex);
    }
  };

  /**
   * Gets the Awair data for the specified device.
   *
   * @param {Object} data State data for Awair
   * @return {Object}
   */
  function _getAwairData(data) {
    try {
      const result = {
        score: data.score,
        sensors: {},
        timeStamp: data.timestamp,
      };
      if (data.co2) {
        result.sensors.co2 = {value: data.co2};
      }
      if (data.humid) {
        result.sensors.humid = {value: data.humid};
      }
      if (data.pm25) {
        result.sensors.pm25 = {value: data.pm25};
      }
      if (data.temp) {
        result.sensors.temp = {value: data.temp};
      }
      if (data.voc) {
        result.sensors.voc = {value: data.voc};
      }
      return result;
    } catch (ex) {
      return null;
    }
  }

  /**
   * Creates an object with the current weather data.
   *
   * @param {Object} weatherNow
   * @return {Object}
   */
  function _getWeather(weatherNow) {
    return {
      lastUpdated: weatherNow.time * 1000,
      humidity: Math.round(weatherNow.humidity * 100),
      temperature: weatherNow.temperature,
      apparentTemperature: weatherNow.apparentTemperature,
      summary: weatherNow.summary,
    };
  }

  /**
   * Creates an object with the current Harmony activity.
   *
   * @param {Object} harmonyActivity
   * @return {Object}
   */
  function _getHarmonyActivity(harmonyActivity) {
    return {
      id: harmonyActivity.id,
      label: harmonyActivity.label,
    };
  }

  /**
   * Creates an object with the current Nest Thermostat data.
   *
   * @param {Object} thermostats
   * @return {Object}
   */
  function _getNestThermostats(thermostats) {
    const results = {};
    const keys = Object.keys(thermostats);
    keys.forEach((k) => {
      const t = thermostats[k];
      results[k] = {
        name: t['name'],
        temperature: t['ambient_temperature_f'],
        humidity: t['humidity'],
        mode: t['hvac_mode'],
        state: t['hvac_state'],
      };
    });
    return results;
  }

  /**
   * Creates an object with the current Nest Protect data.
   * @param {Object} protects
   * @return {Object}
   */
  function _getNestProtects(protects) {
    const results = {};
    const keys = Object.keys(protects);
    keys.forEach((k) => {
      const p = protects[k];
      results[k] = {
        name: p['name'],
        battery: p['battery_health'],
        alarms: {
          co: p['co_alarm_state'],
          smoke: p['smoke_alarm_state'],
        },
        isOnline: p['is_online'],
        lastUpdated: p['last_connection'],
        uiColor: p['ui_color_state'],
      };
    });
    return results;
  }

  /**
   * Creates an object with the current presence data.
   * @param {Object} people
   * @return {Object}
   */
  function _getPresence(people) {
    const results = {};
    Object.keys(people).forEach((k) => {
      results[k] = people[k].state;
    });
    return results;
  }

  /**
   * Creates an object with the current hue sensor data.
   * @param {Object} sensors
   * @param {Number} tempId
   * @param {Number} motionId
   * @param {Number} lightId
   * @return {Object}
   */
  function _getHueSensorData(sensors, tempId, motionId, lightId) {
    const result = {};
    const sTemp = sensors[tempId];
    if (sTemp && sTemp.state && sTemp.state.hasOwnProperty('temperature')) {
      result.temperature = sTemp.state.temperature / 100;
      result.lastUpdated = sTemp.state.lastupdated;
      result.tempUpdated = sTemp.state.lastupdated;
    }
    const sMotion = sensors[motionId];
    if (sMotion && sMotion.state && sMotion.state.hasOwnProperty('presence')) {
      result.presence = sMotion.state.presence;
      result.presenceUpdated = sMotion.state.lastupdated;
    }
    const sLight = sensors[lightId];
    if (sLight && sLight.state && sLight.state.hasOwnProperty('lightlevel')) {
      result.daylight = sLight.state.daylight;
      result.dark = sLight.state.dark;
      result.lightLevel = sLight.state.lightlevel;
      result.lightUpdated = sLight.state.lastupdated;
    }
    if (Object.keys(result).length > 0) {
      return result;
    }
  }

  _init();
}

module.exports = Logging;
