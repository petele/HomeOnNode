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
 * @property {Object} lights - List of all lights and their current state
 * @property {Object} groups - List of all groups and their current state
 * @property {Object} capabilities - Current Hub capabilities
 * @property {Object} dataStore - Entire Hub data store
 * @param {String} key Hue authentication key.
 * @param {String} [explicitIPAddress] IP Address of the Hub
 */
function Hue(key, explicitIPAddress) {
  const REQUEST_TIMEOUT = 15 * 1000;
  const CONFIG_REFRESH_INTERVAL = 10 * 60 * 1000;
  const GROUPS_REFRESH_INTERVAL = 100 * 1000;
  const LIGHTS_REFRESH_INTERVAL = 40 * 1000;
  const _self = this;
  const _key = key;

  let _bridgeIP;
  let _ready = false;
  let _requestsInProgress = 0;

  this.lights = {};
  this.groups = {};
  this.capabilities = {};
  this.dataStore = {};

  /**
   * Turn the lights (or groups) on and off, modify the hue and effects.
   *
   * @param {Array} lights The lights to set
   * @param {Object} cmd The state to apply
   * @return {Promise} A promise that resolves to the response body.
  */
  this.setLights = function(lights, cmd) {
    let msg = `setLights(${JSON.stringify(lights)}, ${JSON.stringify(cmd)})`;
    log.log(LOG_PREFIX, msg);
    if (_isReady() !== true) {
      return Promise.reject(new Error('not_ready'));
    }
    if (Array.isArray(lights) === false) {
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
          _updateLights();
          _updateGroups();
          return resp;
        })
        .catch((err) => {
          log.error(LOG_PREFIX, 'setLights() failed.', err);
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
    log.log(LOG_PREFIX, `setScene('${sceneId}')`);
    if (_isReady() !== true) {
      return Promise.reject(new Error('not_ready'));
    }
    const requestPath = '/groups/0/action';
    const cmd = {scene: sceneId};
    return _makeHueRequest(requestPath, 'PUT', cmd, true)
      .then((resp) => {
        _updateLights();
        _updateGroups();
        return resp;
      })
      .catch((err) => {
        log.error(LOG_PREFIX, `setScene('${sceneId}')`, err);
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
    log.log(LOG_PREFIX, `sendRequest('${requestPath}', '${method}', ${body})`);
    if (_isReady() !== true) {
      return Promise.reject(new Error('not_ready'));
    }
    if (!requestPath || !method) {
      return Promise.reject(new Error('missing_parameter'));
    }
    return _makeHueRequest(requestPath, method, body);
  };

  /**
   * Init the API
  */
  function _init() {
    log.init(LOG_PREFIX, 'Starting...');
    _findHub()
    .then((bridgeIP) => {
      _bridgeIP = bridgeIP;
      _updateConfig();
      _updateLights();
      _updateGroups();
      _ready = true;
      log.log(LOG_PREFIX, 'Ready.');
      setInterval(_updateConfig, CONFIG_REFRESH_INTERVAL);
      setInterval(_updateGroups, GROUPS_REFRESH_INTERVAL);
      setInterval(_updateLights, LIGHTS_REFRESH_INTERVAL);
    });
  }

  /**
   * Is API ready?
   *
   * @return {Boolean} true if ready, false if not
  */
  function _isReady() {
    if (_ready) {
      return true;
    }
    log.error(LOG_PREFIX, 'Hue not ready.');
    return false;
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
      }, delayMS);
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
    _requestsInProgress++;
    let msg = `makeHueRequest('${method}', '${requestPath}')`;
    if (_requestsInProgress >= 5) {
      let xrpMsg = `Excessive requests in progress (${_requestsInProgress}`;
      log.warn(LOG_PREFIX, xrpMsg);
    }
    log.verbose(LOG_PREFIX, msg, body);
    return new Promise(function(resolve, reject) {
      let requestOptions = {
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
        _requestsInProgress -= 1;
        let errors = [];
        if (error) {
          log.verbose(LOG_PREFIX, `${msg} Response error: request`, error);
          if (retry !== true) {
            reject(error);
            return;
          }
          errors.push(error);
        }
        if (response && response.statusCode) {
          log.verbose(LOG_PREFIX, `${msg}: ${response.statusCode}`);
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
          log.warn(LOG_PREFIX, `${msg} - will retry.`);
          resolve(_makeHueRequest(requestPath, method, body, false));
          return;
        }
        reject(errors);
      });
    });
  }

  /**
   * Updates this.groups to the latest state from the hub.
   *
   * @return {Promise} True if updated, false if failed.
   */
  function _updateGroups() {
    // log.log(LOG_PREFIX, '_updateGroups()');
    const requestPath = '/groups';
    return _makeHueRequest(requestPath, 'GET', null, false)
    .then((groups) => {
      if (diff(_self.groups, groups)) {
        _self.groups = groups;
        /**
         * see {@link https://developers.meethue.com/documentation/groups-api#21_get_all_groups}
         * @event Hue#groups_changed
         */
        _self.emit('groups_changed', groups);
      }
      return true;
    })
    .catch((error) => {
      log.exception(LOG_PREFIX, `Unable to retreive groups`, error);
      return false;
    });
  }

  /**
   * Updates this.lights to the latest state from the hub.
   *
   * @fires Hue#lights_changed.
   * @return {Promise} True if updated, false if failed.
  */
  function _updateLights() {
    // log.log(LOG_PREFIX, '_updateLights()');
    const requestPath = '/lights';
    return _makeHueRequest(requestPath, 'GET', null, false)
    .then((lights) => {
      if (diff(_self.lights, lights)) {
        _self.lights = lights;
        /**
         * see {@link https://developers.meethue.com/documentation/lights-api#11_get_all_lights}
         * @event Hue#lights_changed
         */
        _self.emit('lights_changed', lights);
      }
      return true;
    })
    .catch((error) => {
      log.exception(LOG_PREFIX, `Unable to retreive lights`, error);
      return false;
    });
  }

  // /**
  //  * Updates this.config to the latest state from the hub.
  //  *
  //  * @return {Promise} True if updated, false if failed.
  //  */
  // function _updateConfig() {
  //   // log.log(LOG_PREFIX, '_updateConfig()');
  //   return _makeHueRequest('', 'GET', null, false)
  //   .then((dataStore) => {
  //     if (diff(_self.dataStore, dataStore)) {
  //       _self.dataStore = dataStore;
  //       /**
  //        * see {@link https://developers.meethue.com/documentation/configuration-api}
  //        * @event Hue#config_changed
  //        */
  //       _self.emit('config_changed', dataStore);
  //     }
  //     return true;
  //   })
  //   .catch((error) => {
  //     log.exception(LOG_PREFIX, 'Unable to retreive config', error);
  //     return false;
  //   });
  // }

  /**
   * Updates this.dataStore to the latest state from the hub.
   *
   * @return {Promise} True if updated, false if failed.
   */
  function _updateConfig() {
    const pDataStore = _makeHueRequest('', 'GET', null, false);
    const pCapabilities = _delayedHueRequest('/capabilities', null, false, 800);
    return Promise.all([pDataStore, pCapabilities])
      .then((results) => {
        let hasChanged = false;

        // Has the dataStore changed?
        if (diff(_self.dataStore, results[0])) {
          _self.dataStore = results[0];
          hasChanged = true;
        }
        // Have the capabilities changed?
        if (diff(_self.capabilities, results[1])) {
          _self.capabilities = results[1];
          hasChanged = true;
        }
        // Has something changed?
        if (hasChanged) {
          const config = Object.assign({}, _self.dataStore);
          config.capabilities = _self.capabilities;
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
        log.log(LOG_PREFIX, `Using provided IP address: ${explicitIPAddress}`);
        let ip = explicitIPAddress;
        explicitIPAddress = null;
        resolve(ip);
        return;
      }
      log.log(LOG_PREFIX, 'Searching for Hue Hub...');
      const nupnp = {
        url: 'https://www.meethue.com/api/nupnp',
        method: 'GET',
        json: true,
      };
      request(nupnp, (error, response, respBody) => {
        if (Array.isArray(respBody) &&
            respBody.length >= 1 &&
            respBody[0].internalipaddress) {
          log.log(LOG_PREFIX, `Bridge found: ${respBody[0].internalipaddress}`);
          resolve(respBody[0].internalipaddress);
          return;
        }
        let errMsg = 'NUPNP search failed:';
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

  _init();
}

util.inherits(Hue, EventEmitter);

module.exports = Hue;
