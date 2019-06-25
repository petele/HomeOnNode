'use strict';

const util = require('util');
const request = require('request');
const log = require('./SystemLog2');
const diff = require('deep-diff').diff;
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
 * @param {String} [explicitIPAddress] IP Address of the Hub
 */
function Hue(key, explicitIPAddress) {
  const REQUEST_TIMEOUT = 15 * 1000;
  const BATTERY_REFRESH_INTERVAL = (24 * 60 * 60 * 1000) + 31;
  const CONFIG_REFRESH_INTERVAL = (10 * 60 * 1000) + 23;
  const LIGHTS_REFRESH_INTERVAL = 29 * 1000;
  const SENSORS_REFRESH_INTERVAL = 97 * 1000;
  const _self = this;
  const _key = key;

  let _bridgeIP;
  let _ready = false;

  const _requestQueue = {};
  let _requestId = 0;

  this.dataStore = {};
  let _capabilities = {};

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

  /**
   * Update all data from the hub.
   * @return {Promise}
   */
  this.updateHub = function() {
    const msg = `updateHub()`;
    if (!_self.isReady()) {
      log.error(LOG_PREFIX, `${msg} failed. Hue not ready.`);
      return Promise.reject(new Error('not_ready'));
    }
    log.debug(LOG_PREFIX, msg);
    return _updateConfig()
        .then(() => {
          log.verbose(LOG_PREFIX, `${msg} completed.`);
          return;
        })
        .catch((err) => {
          log.warn(LOG_PREFIX, `${msg} failed.`, err);
          return;
        });
  };

  /**
   * Updates sceneId for the specified rules
   *
   * @param {Array} rulesToUpdate An array of ruleIds to update.
   * @param {String} sceneId The scene to set when motion is detected.
   * @return {Promise}
   */
  this.setSceneForRules = function(rulesToUpdate, sceneId) {
    const msg = `setSceneForRules([${rulesToUpdate}], '${sceneId}')`;
    if (!_self.isReady()) {
      log.error(LOG_PREFIX, `${msg} failed. Hue not ready.`);
      return Promise.reject(new Error('not_ready'));
    }
    log.debug(LOG_PREFIX, msg);
    return _makeHueRequest('/rules', 'GET', null, true)
        .then((rules) => {
          if (!rules || typeof rules !== 'object') {
            log.error(LOG_PREFIX, `${msg} failed. No valid rules.`, rules);
            return Promise.reject(new TypeError('rules_not_valid'));
          }
          return Promise.all(rulesToUpdate.map((ruleId) => {
            // Get the specified rule
            const rule = rules[ruleId];
            if (!rule) {
              const m = `Could not find rule for id: '${ruleId}'.`;
              log.warn(LOG_PREFIX, `${msg} failed. ${m}`);
              return;
            }
            // Make a copy of the rule to work with.
            const updatedRule = {
              actions: rule.actions.slice(0),
              conditions: rule.conditions.slice(0),
            };
            // Iterate through the actions and update any scenes.
            updatedRule.actions.forEach((action) => {
              if (action.body && action.body.scene) {
                action.body.scene = sceneId;
              }
            });
            // Push the updated rule to the server.
            const requestPath = `/rules/${ruleId}`;
            return _makeHueRequest(requestPath, 'PUT', updatedRule, true)
                .catch((ex) => {
                  const m = `Unable to update rule at '${requestPath}'.`;
                  log.warn(LOG_PREFIX, `${msg} warning. ${m}`, ex);
                });
          }));
        })
        .then((results) => {
          _promisedSleep(500)
              .then(() => {
                _updateRules();
              });
          return results;
        });
  };

  /**
   * Init the API
  */
  function _init() {
    log.init(LOG_PREFIX, 'Starting...');
    _findHub()
        .then((bridgeIP) => {
          _bridgeIP = bridgeIP;
          return _updateConfig();
        })
        .then(() => {
          _ready = true;
          log.debug(LOG_PREFIX, 'Ready.');
          log.verbose(LOG_PREFIX, 'Starting interval timers...');
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
        });
  }

  /**
   * A function that sleeps for the specified length of time.
   *
   * @param {number} timeout Length of time to sleep (ms).
   * @return {Promise} An empty promise once the time is up.
   */
  function _promisedSleep(timeout) {
    return new Promise((resolve) => {
      setTimeout(() => {
        resolve();
      }, timeout || 30000);
    });
  }

  /**
   * Timer tick for updating config information.
   * @return {Promise}
   */
  function _updateConfigTick() {
    return _updateConfig()
        .then(() => {
          return _promisedSleep(CONFIG_REFRESH_INTERVAL);
        })
        .then(() => {
          _updateConfigTick();
        });
  }

  /**
   * Timer tick for updating lights information.
   * @return {Promise}
   */
  function _updateLightsAndGroupsTick() {
    return _updateLightsAndGroups()
        .then(() => {
          return _promisedSleep(LIGHTS_REFRESH_INTERVAL);
        })
        .then(() => {
          _updateLightsAndGroupsTick();
        });
  }

  /**
   * Timer tick for updating lights information.
   * @return {Promise}
   */
  function _updateSensorsTick() {
    return _updateSensors()
        .then(() => {
          return _promisedSleep(SENSORS_REFRESH_INTERVAL);
        })
        .then(() => {
          _updateSensorsTick();
        });
  }

  /**
   * Timer tick for checking the batteries.
   * @return {Promise}
   */
  function _checkBatteriesTick() {
    _checkBatteries();
    return _promisedSleep(BATTERY_REFRESH_INTERVAL)
        .then(() => {
          _checkBatteriesTick();
        });
  }

  /**
   * Delayed Hue Request
   * @param {String} requestPath the URL/request path to hit
   * @param {String} method the HTTP method to use
   * @param {Object} [body] The body to send along with the request
   * @param {Boolean} [retry] If the request fails, should it retry
   * @param {Number} delayMS MS to delay the call
   * @return {Promise} A promise that resolves with the response
   */
  function _delayedHueRequest(requestPath, method, body, retry, delayMS) {
    return new Promise((resolve, reject) => {
      setTimeout(() => {
        resolve(_makeHueRequest(requestPath, method, body, retry));
      }, delayMS || 30 * 1000);
    });
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
  function _makeHueRequest(requestPath, method, body, retry) {
    const b = body ? 'body' : 'null';
    const msg = `makeHueRequest('${method}', '${requestPath}', ${b}, ${retry})`;
    const requestId = _requestId++;
    _requestQueue[requestId] = {
      requestId: requestId,
      path: `${method}://${requestPath}`,
      startedAt: Date.now(),
    };
    log.verbose(LOG_PREFIX, `${msg} [${requestId}]`, body);

    const requestsInProgress = Object.keys(_requestQueue).length;
    if (requestsInProgress >= 8) {
      const xrpMsg = `Excessive requests in progress (${requestsInProgress})`;
      log.warn(LOG_PREFIX, xrpMsg, _requestQueue);
    }

    return new Promise((resolve, reject) => {
      const requestOptions = {
        uri: `https://${_bridgeIP}/api/${_key}${requestPath}`,
        method: method,
        json: true,
        timeout: REQUEST_TIMEOUT,
        agent: false,
        strictSSL: false,
      };
      if (body) {
        requestOptions.body = body;
      }
      request(requestOptions, (error, response, respBody) => {
        delete _requestQueue[requestId];
        const errors = [];
        if (error) {
          log.verbose(LOG_PREFIX, `${msg} Response error: request`, error);
          if (retry !== true) {
            reject(error);
            return;
          }
          errors.push(error);
        }
        if (response && response.statusCode) {
          // log.verbose(LOG_PREFIX, `${msg}: ${response.statusCode}`);
          if (response.statusCode !== 200) {
            const statusCodeError = {
              statusCode: response.statusCode,
              body: respBody,
            };
            errors.push(statusCodeError);
          }
        }
        if (respBody) {
          if (respBody.error) {
            log.verbose(LOG_PREFIX, `${msg} Response error: body.`, error);
            errors.push(respBody);
          } else if (Array.isArray(respBody)) {
            respBody.forEach((item) => {
              if (item.error) {
                errors.push(item);
                log.verbose(LOG_PREFIX, `${msg} Response error: item.`, item);
              }
            });
          }
        }
        if (errors.length === 0) {
          resolve(respBody);
          return;
        }
        if (retry === true) {
          log.warn(LOG_PREFIX, `${msg} - will retry.`, errors);
          resolve(_makeHueRequest(requestPath, method, body, false));
          return;
        }
        reject(errors);
      });
    });
  }

  /**
   * Updates this.rules to the latest state from the hub.
   *
   * @return {Promise} True if updated, false if failed.
   */
  function _updateRules() {
    const requestPath = '/rules';
    return _makeHueRequest(requestPath, 'GET', null, false)
        .then((rules) => {
          return _hasValueChanged('rules', rules);
        })
        .catch((error) => {
          log.exception(LOG_PREFIX, `Unable to retreive rules`, error);
          return false;
        });
  }

  /**
   * Updates this.sensors to the latest state from the hub.
   *
   * @return {Promise} True if updated, false if failed.
   */
  function _updateSensors() {
    const requestPath = '/sensors';
    return _makeHueRequest(requestPath, 'GET', null, false)
        .then((sensors) => {
          return _hasValueChanged('sensors', sensors);
        })
        .catch((error) => {
          log.exception(LOG_PREFIX, `Unable to retreive sensors`, error);
          return false;
        });
  }

  /**
   * Checks if lights or groups have changed and if so, report the result
   *
   * @return {Promise}
   */
  function _updateLightsAndGroups() {
    return _makeHueRequest('/lights', 'GET', null, true)
        .then((lights) => {
          const result = {
            lights: _hasValueChanged('lights', lights),
            groups: false,
          };
          if (result.lights) {
            return _promisedSleep(400)
                .then(() => {
                  return _makeHueRequest('/groups', 'GET', null, true);
                })
                .then((groups) => {
                  result.groups = _hasValueChanged('groups', groups);
                  return result;
                });
          }
          return result;
        })
        .catch((error) => {
          log.exception(LOG_PREFIX, `Unable to update lights/groups`, error);
          return false;
        });
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
   * @return {Promise} True if updated, false if failed.
   */
  function _updateConfig() {
    const pDataStore = _makeHueRequest('', 'GET', null, false);
    const pCapPath = '/capabilities';
    const pCapabilities = _delayedHueRequest(pCapPath, 'GET', null, false, 500);
    return Promise.all([pDataStore, pCapabilities])
        .then((results) => {
          const newDataStore = results[0];
          const newCapabilities = results[1];
          let capabilitiesChanged = false;
          let configChanged = false;

          // Verify we have a dataStore to work with.
          if (!_self.dataStore) {
            _self.dataStore = {};
          }

          // Has the dataStore changed?
          if (diff(_self.dataStore, newDataStore)) {
            _self.dataStore = newDataStore;
            configChanged = true;
          }

          // Have the capabilities changed?
          if (diff(_capabilities, newCapabilities)) {
            _capabilities = newCapabilities;
            capabilitiesChanged = true;
          }

          // Has something changed?
          if (capabilitiesChanged || configChanged) {
            const config = Object.assign({}, newDataStore);
            config.capabilities = Object.assign({}, _capabilities);
            _self.emit('config_changed', config);
          }
          return true;
        })
        .catch((error) => {
          log.exception(LOG_PREFIX, 'Unable to get config/capabilities', error);
          return false;
        });
  }

  /**
   * Uses NUPNP to find the first Hue Hub on the local network.
   *
   * @return {Promise} a Promise that resolves with the IP address of the hub
  */
  function _findHub() {
    return new Promise(function(resolve, reject) {
      if (explicitIPAddress) {
        log.debug(LOG_PREFIX, `Using provided IP: ${explicitIPAddress}`);
        resolve(explicitIPAddress);
        return;
      }
      log.debug(LOG_PREFIX, 'Searching for Hue Hub...');
      const nupnp = {
        url: 'https://discovery.meethue.com',
        method: 'GET',
        json: true,
      };
      request(nupnp, (error, response, respBody) => {
        if (Array.isArray(respBody) &&
            respBody.length >= 1 &&
            respBody[0].internalipaddress) {
          const ip = respBody[0].internalipaddress;
          log.debug(LOG_PREFIX, `Bridge found: ${ip}`);
          resolve(ip);
          return;
        }
        const errMsg = 'NUPNP search failed:';
        if (error) {
          log.exception(LOG_PREFIX, `${errMsg} request error.`, error);
        } else if (Array.isArray(respBody) && respBody.length === 0) {
          log.error(LOG_PREFIX, `${errMsg} no hubs found.`);
        } else {
          log.error(LOG_PREFIX, `${errMsg} unhandled response.`, respBody);
        }
        log.error(LOG_PREFIX, 'No bridge found, will retry in 2 minutes.');
        setTimeout(() => {
          resolve(_findHub());
        }, 2 * 60 * 1000);
      });
    });
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

  _init();
}

util.inherits(Hue, EventEmitter);

module.exports = Hue;
