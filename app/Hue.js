'use strict';

const util = require('util');
// const https = require('https');
const fetch = require('node-fetch');
const log = require('./SystemLog2');
const diff = require('deep-diff').diff;
const honHelpers = require('./HoNHelpers');
const EventEmitter = require('events').EventEmitter;

const LOG_PREFIX = 'HUE';

/**
 * Philips Hue API.
 * @constructor
 *
 * @fires Hue#config_changed
 * @fires Hue#groups_changed
 * @fires Hue#lights_changed
 * @fires Hue#sensors_changed
 * @property {Object} dataStore - Entire Hub data store
 * @param {String} key Hue authentication key.
 * @param {String} ipAddress IP Address of the Hub
 */
function Hue(key, ipAddress) {
  const REQUEST_TIMEOUT = 15 * 1000;
  const BATTERY_REFRESH_INTERVAL = (24 * 60 * 60 * 1000) + 31;
  const CONFIG_REFRESH_INTERVAL = (10 * 60 * 1000) + 23;
  const LIGHTS_REFRESH_INTERVAL = 29 * 1000;
  const SENSORS_REFRESH_INTERVAL = 97 * 1000;
  const _self = this;
  const _key = key;

  const _bridgeIP = ipAddress;
  let _ready = false;
  let _connectionStarted = false;

  this.dataStore = {};

  /**
   * Connect to the Hue bridge for the first time.
   * @param {Boolean} retry
   */
  this.connect = async function(retry) {
    if (_ready) {
      return true;
    }
    if (_connectionStarted) {
      log.warn(LOG_PREFIX, 'Connection attempt already in progress...');
      return false;
    }
    _connectionStarted = true;
    log.init(LOG_PREFIX, 'Connecting...');

    try {
      await _updateConfig();
    } catch (ex) {
      if (retry) {
        _retryInitialConnection(retry);
      } else {
        _connectionStarted = false;
      }
      return false;
    }
    _ready = true;
    log.debug(LOG_PREFIX, 'Connected.');
    setTimeout(() => {
      _updateConfigTick();
    }, CONFIG_REFRESH_INTERVAL);
    setTimeout(() => {
      _updateLightsAndGroupsTick();
    }, LIGHTS_REFRESH_INTERVAL);
    setTimeout(() => {
      _updateSensorsTick();
    }, SENSORS_REFRESH_INTERVAL);
    setTimeout(() => {
      _checkBatteriesTick();
    }, BATTERY_REFRESH_INTERVAL);
    _self.emit('ready');
    return true;
  };

  /**
   * Retry the initial connection if it didn't succeed.
   *
   * @param {Boolean} [retry]
   */
  function _retryInitialConnection(retry) {
    setTimeout(() => {
      _connectionStarted = false;
      _self.connect(retry);
    }, 90 * 1000);
  }

  /**
   * Is API ready?
   *
   * @return {Boolean} true if ready, false if not
  */
  this.isReady = function() {
    return _ready === true;
  };

  /**
   * Create a throttled version of a function.
   *
   * @param {Function} func function to throttle.
   * @param {Number} limit Time limit to run at.
   * @return {Function} a throttled version of the function.
   */
  const _throttle = (func, limit) => {
    let lastFunc;
    let lastRan;
    return function(...args) {
      // eslint-disable-next-line no-invalid-this
      const context = this;
      if (!lastRan) {
        lastRan = Date.now();
        return func.apply(context, args);
      }
      clearTimeout(lastFunc);
      lastFunc = setTimeout(() => {
        if ((Date.now() - lastRan) >= limit) {
          lastRan = Date.now();
          func.apply(context, args);
        }
      }, limit - (Date.now() - lastRan));
    };
  };

  const _updateThrottled = _throttle(_updateLightsAndGroups, 2500);

  /**
   * Turn the lights (or groups) on and off, modify the hue and effects.
   *
   * @param {Array} lights The lights to set
   * @param {Object} cmd The state to apply
   * @return {Promise} A promise that resolves to the response body.
  */
  this.setLights = function(lights, cmd) {
    const msg = `setLights(${JSON.stringify(lights)}, ${JSON.stringify(cmd)})`;
    if (!_self.isReady()) {
      log.error(LOG_PREFIX, `${msg} failed. Hue not ready.`);
      return Promise.reject(new Error('not_ready'));
    }
    log.debug(LOG_PREFIX, msg);
    if (!Array.isArray(lights)) {
      lights = [lights];
    }
    if (cmd.on === false) {
      cmd = {on: false};
    } else {
      cmd.on = true;
    }
    return Promise.all(lights.map((light) => {
      let requestPath = `/lights/${light}/state`;
      if (light <= 0) {
        requestPath = `/groups/${Math.abs(light)}/action`;
      }
      return _makeHueRequest(requestPath, 'PUT', cmd, true)
          .then((resp) => {
            _updateThrottled();
            return resp;
          })
          .catch((err) => {
            err.requestPath = requestPath;
            log.error(LOG_PREFIX, `${msg} failed.`, err);
            return err;
          });
    }));
  };

  /**
   * Applies a scene
   *
   * @param {String} sceneId The scene ID to set.
   * @return {Promise} A promise that resolves to the response body.
  */
  this.setScene = function(sceneId) {
    const msg = `setScene('${sceneId}')`;
    if (!_self.isReady()) {
      log.error(LOG_PREFIX, `${msg} failed. Hue not ready.`);
      return Promise.reject(new Error('not_ready'));
    }
    log.debug(LOG_PREFIX, msg);
    const requestPath = '/groups/0/action';
    const cmd = {scene: sceneId};
    return _makeHueRequest(requestPath, 'PUT', cmd, true)
        .then((resp) => {
          _updateThrottled();
          return resp;
        })
        .catch((err) => {
          log.error(LOG_PREFIX, `${msg} failed.`, err);
          return err;
        });
  };

  /**
   * Send a Raw command
   *
   * @param {String} requestPath the URL/request path to hit
   * @param {String} method the HTTP method to use
   * @param {Object} [body] The body to send along with the request
   * @return {Promise} A promise that resolves with the response
  */
  this.sendRequest = function(requestPath, method, body) {
    const msg = `sendRequest('${requestPath}', '${method}')`;
    if (!_self.isReady()) {
      log.error(LOG_PREFIX, `${msg} failed. Hue not ready.`, body);
      return Promise.reject(new Error('not_ready'));
    }
    log.debug(LOG_PREFIX, msg, body);
    if (!requestPath || !method) {
      return Promise.reject(new TypeError('missing_parameter'));
    }
    return _makeHueRequest(requestPath, method, body)
        .catch((err) => {
          log.error(LOG_PREFIX, `${msg} failed.`, err);
          return err;
        });
  };

  // /**
  //  * Update all data from the hub.
  //  * @return {Promise}
  //  */
  // this.updateHub = function() {
  //   const msg = `updateHub()`;
  //   if (!_self.isReady()) {
  //     log.error(LOG_PREFIX, `${msg} failed. Hue not ready.`);
  //     return Promise.reject(new Error('not_ready'));
  //   }
  //   log.debug(LOG_PREFIX, msg);
  //   return _updateConfig()
  //       .then(() => {
  //         log.verbose(LOG_PREFIX, `${msg} completed.`);
  //         return;
  //       })
  //       .catch((err) => {
  //         log.warn(LOG_PREFIX, `${msg} failed.`, err);
  //         return;
  //       });
  // };

  /**
   * Updates sceneId for the specified rules
   *
   * @param {Array} rulesToUpdate An array of ruleIds to update.
   * @param {String} sceneId The scene to set when motion is detected.
   * @return {Promise}
   */
  this.setSceneForRules = async function(rulesToUpdate, sceneId) {
    const msg = `setSceneForRules([${rulesToUpdate}], '${sceneId}')`;
    if (!_self.isReady()) {
      log.error(LOG_PREFIX, `${msg} failed. Hue not ready.`);
      return Promise.reject(new Error('not_ready'));
    }
    log.debug(LOG_PREFIX, msg);

    const rules = await _makeHueRequest('/rules', 'GET', null, true);
    if (!rules || typeof rules !== 'object') {
      log.error(LOG_PREFIX, `${msg} failed. No valid rules.`, rules);
      throw new TypeError('rules_not_valid');
    }

    const requests = rulesToUpdate.map(async (ruleId, idx) => {
      // Do we need to update the rule?
      let updateRule = false;

      // Get the specified rule
      const rule = rules[ruleId];
      if (!rule) {
        const m = `Could not find rule for id: '${ruleId}'.`;
        log.warn(LOG_PREFIX, `${msg} failed. ${m}`);
        return;
      }

      // Make a copy of the rule to work with.
      const updatedRule = {
        actions: rule.actions.slice(),
        conditions: rule.conditions.slice(),
      };

      // Iterate through the actions and update any scenes.
      updatedRule.actions.forEach((action) => {
        if (action.body && action.body.scene && action.body.scene !== sceneId) {
          action.body.scene = sceneId;
          updateRule = true;
        }
      });

      // Rule doesn't need to be changed.
      if (!updateRule) {
        return null;
      }

      // Wait a tiny bit of time so we don't overload the server.
      await honHelpers.sleep(idx * 150);

      const requestPath = `/rules/${ruleId}`;
      return _makeHueRequest(requestPath, 'PUT', updatedRule, true)
          .catch((ex) => {
            const m = `Unable to update rule at '${requestPath}'.`;
            log.warn(LOG_PREFIX, `${msg} warning. ${m}`, ex);
          });
    });

    // Wait for all rules to be updated.
    const results = await Promise.all(requests);
    // Wait 500 ms for the rules to be properly updated on the server.
    await honHelpers.sleep(500);
    await _updateRules();
    return results;
  };

  /**
   * Timer tick for updating config information.
   * @return {Promise}
   */
  async function _updateConfigTick() {
    try {
      await _updateConfig(true);
    } catch (ex) {
      log.error(LOG_PREFIX, 'Unable to update config.', ex);
    }
    await honHelpers.sleep(CONFIG_REFRESH_INTERVAL);
    return _updateConfigTick();
  }

  /**
   * Timer tick for updating lights information.
   * @return {Promise}
   */
  async function _updateLightsAndGroupsTick() {
    await _updateLightsAndGroups();
    await honHelpers.sleep(LIGHTS_REFRESH_INTERVAL);
    return _updateLightsAndGroupsTick();
  }

  /**
   * Timer tick for updating lights information.
   * @return {Promise}
   */
  async function _updateSensorsTick() {
    await _updateSensors();
    await honHelpers.sleep(SENSORS_REFRESH_INTERVAL);
    return _updateSensorsTick();
  }

  /**
   * Timer tick for checking the batteries.
   * @return {Promise}
   */
  async function _checkBatteriesTick() {
    await _checkBatteries();
    await honHelpers.sleep(BATTERY_REFRESH_INTERVAL);
    return _checkBatteriesTick();
  }

  /**
   * Helper function to make a Hue request
   *
   * @param {String} requestPath the URL/request path to hit
   * @param {String} method the HTTP method to use
   * @param {Object} [body] The body to send along with the request
   * @param {Boolean} [retry] If the request fails, should it retry
   * @return {Promise} A promise that resolves with the response
  */
  async function _makeHueRequest(requestPath, method, body, retry) {
    const url = `http://${_bridgeIP}/api/${_key}${requestPath}`;
    const msg = `makeHueRequest('${method}', '${requestPath}', ${retry})`;
    const fetchOpts = {
      method: method || 'GET',
      timeout: REQUEST_TIMEOUT,
      headers: {},
    };
    if (body) {
      fetchOpts.body = JSON.stringify(body);
      fetchOpts.headers['Content-Type'] = 'application/json';
    }
    let resp;
    try {
      log.verbose(LOG_PREFIX, `${msg}`, body);
      resp = await fetch(url, fetchOpts);
    } catch (ex) {
      log.error(LOG_PREFIX, `${msg} - Request error`, ex);
      if (retry) {
        await honHelpers.sleep(250);
        return _makeHueRequest(requestPath, method, body, false);
      }
      throw ex;
    }

    if (!resp.ok) {
      log.error(LOG_PREFIX, `${msg} - Response error`, resp);
      if (retry) {
        await honHelpers.sleep(250);
        return _makeHueRequest(requestPath, method, body, false);
      }
      throw new Error('Response Error');
    }

    let respBody;
    try {
      respBody = await resp.json();
    } catch (ex) {
      log.error(LOG_PREFIX, `${msg} - JSON error`, ex);
      if (retry) {
        await honHelpers.sleep(250);
        return _makeHueRequest(requestPath, method, body, false);
      }
      throw new Error('JSON Conversion Error');
    }

    const errors = [];
    if (respBody.error) {
      log.verbose(LOG_PREFIX, `${msg} Response error: body.`, respBody);
      errors.push(respBody);
    } else if (Array.isArray(respBody)) {
      respBody.forEach((item) => {
        if (item.error) {
          log.verbose(LOG_PREFIX, `${msg} Response error: item.`, item);
          errors.push(item);
        }
      });
    }

    if (errors.length === 0) {
      return respBody;
    }

    if (retry) {
      log.warn(LOG_PREFIX, `${msg} - will retry.`, errors);
      await honHelpers.sleep(250);
      return _makeHueRequest(requestPath, method, body, false);
    }

    log.error(LOG_PREFIX, `${msg} - will retry.`, errors);
    throw new Error('Failed');
  }

  /**
   * Updates this.rules to the latest state from the hub.
   *
   * @return {Promise} True if updated, false if failed.
   */
  async function _updateRules() {
    try {
      const rules = await _makeHueRequest('/rules', 'GET', null, false);
      return _hasValueChanged('rules', rules);
    } catch (ex) {
      log.exception(LOG_PREFIX, `Unable to retreive rules`, ex);
      return false;
    }
  }

  /**
   * Updates this.sensors to the latest state from the hub.
   *
   * @return {Promise} True if updated, false if failed.
   */
  async function _updateSensors() {
    try {
      const sensors = await _makeHueRequest('/sensors', 'GET', null, false);
      return _hasValueChanged('sensors', sensors);
    } catch (ex) {
      log.exception(LOG_PREFIX, `Unable to retreive sensors`, ex);
      return false;
    }
  }

  /**
   * Checks if lights or groups have changed and if so, report the result
   *
   * @return {Promise}
   */
  async function _updateLightsAndGroups() {
    try {
      const lights = await _makeHueRequest('/lights', 'GET', null, true);
      _hasValueChanged('lights', lights);
    } catch (ex) {
      log.exception(LOG_PREFIX, `Unable to update lights`, ex);
    }

    await honHelpers.sleep(600);

    try {
      const groups = await _makeHueRequest('/groups', 'GET', null, true);
      _hasValueChanged('groups', groups);
    } catch (ex) {
      log.exception(LOG_PREFIX, `Unable to update groups`, ex);
    }
  }

  /**
   * Checks if the new sensor data matches the current sensor data.
   *
   * @fires Hue#`${key}_changed`.
   * @param {String} key dataStore 'key' to check against.
   * @param {Object} newVal new value.
   * @return {boolean} True if it's changed, false for invalid or same.
   */
  function _hasValueChanged(key, newVal) {
    if (!_self.dataStore || typeof _self.dataStore !== 'object') {
      const ds = _self.dataStore;
      log.error(LOG_PREFIX, 'hasValueChanged: invalid dataStore', ds);
      return false;
    }
    if (typeof newVal !== 'object') {
      log.error(LOG_PREFIX, 'hasValueChanged: newVal not an object', newVal);
      return false;
    }
    if (Object.keys(newVal).length === 0) {
      log.error(LOG_PREFIX, 'hasValueChanged: empty newVal', newVal);
      return false;
    }
    if (diff(_self.dataStore[key], newVal)) {
      _self.dataStore[key] = newVal;
      _self.emit(`${key}_changed`, newVal);
      return true;
    }
    return false;
  }

  /**
   * Updates this.dataStore to the latest state from the hub.
   *
   * @param {Boolean} retry Should it retry the connection.
   * @return {Promise} True if updated, false if failed.
   */
  async function _updateConfig(retry) {
    const dataStore = await _makeHueRequest('', 'GET', null, retry);
    await honHelpers.sleep(250);
    const cPath = '/capabilities';
    const capabilities = await _makeHueRequest(cPath, 'GET', null, retry);
    await honHelpers.sleep(250);
    const rLinks = await _makeHueRequest('/resourcelinks', 'GET', null, retry);

    dataStore.capabilities = capabilities;
    dataStore.resourcelinks = rLinks;

    if (diff(_self.dataStore, dataStore)) {
      _self.dataStore = dataStore;
      _self.emit('config_changed', _self.dataStore);
      return true;
    }

    return false;
  }

  /**
   * Check batteries
   */
  function _checkBatteries() {
    if (!_self.dataStore.sensors) {
      log.warn(LOG_PREFIX, 'checkBatteries() failed, no sensors available.');
      return;
    }
    log.verbose(LOG_PREFIX, 'Checking batteries...');
    const keys = Object.keys(_self.dataStore.sensors);
    keys.forEach((key) => {
      const sensor = _self.dataStore.sensors[key];
      if (!sensor || !sensor.config) {
        return;
      }
      const sConfig = sensor.config;
      const msgBase = `${sensor.name} (${sensor.modelid}) [${key}]`;
      if (sConfig.reachable === false) {
        const msg = `${msgBase} is unreachable.`;
        log.warn(LOG_PREFIX, msg, sensor);
        // _self.emit('sensor_unreachable', sensor);
      }
      if (sConfig.battery && sConfig.battery < 50) {
        const msg = `${msgBase} has a low battery (${sConfig.battery}%)`;
        log.warn(LOG_PREFIX, msg, sensor);
        // _self.emit('sensor_low_battery', sensor);
      }
    });
  }
}

util.inherits(Hue, EventEmitter);

module.exports = Hue;
