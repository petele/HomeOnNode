'use strict';

const EventEmitter = require('events').EventEmitter;
const util = require('util');
const diff = require('deep-diff').diff;
const request = require('request');
const log = require('./SystemLog2');

// Consider adding queue to API to ensure we don't over extend

const LOG_PREFIX = 'NANOLEAF';

/**
 * NanoLeaf API.
 *
 * @param {String} key Authentication key.
 * @param {String} ip IP address of the hub.
 * @param {String} port Port of the hub.
*/
function NanoLeaf(key, ip, port) {
  const _hubAddress = `http://${ip}:${port}/api/v1/${key}/`;
  let _ready = false;
  let _state = {};
  const REFRESH_INTERVAL = 45 * 1000;
  this.state = _state;
  const _announce = this.emit;

  /**
   * Execute a NanoLeaf command.
   *
   * @param {Object} command The command to run.
   * @param {String} modifier Any modifiers to change the command
   * @return {Promise} The promise that will be resolved on completion.
  */
  this.executeCommand = function(command, modifier) {
    if (modifier === 'OFF') {
      return _setPower(false);
    }
    if (command.effect) {
      return _setEffect(command.effect);
    }
    if (command.brightness) {
      return _setBrightness(command.brightness);
    }
    if (command.colorTemp) {
      return _setColorTemperature(command.colorTemp);
    }
    if (command.hue && command.sat) {
      return _setHueAndSat(command.hue, command.sat);
    }
    return Promise.reject(new Error('unknown_command'));
  };

  /**
   * Init
  */
  function _init() {
    log.init(LOG_PREFIX, 'Starting NanoLeaf...');
    _getState.then((state) => {
      setInterval(_getState, REFRESH_INTERVAL);
    });
  }

  /**
   * Checks if system is ready
   *
   * @return {Boolean} true if system is ready, false if not.
  */
  function _isReady() {
    if (_ready) {
      return true;
    }
    log.error(LOG_PREFIX, 'NanoLeaf not ready.');
    return false;
  }

  /**
   * Makes a request to the leaf hub.
   *
   * @param {string} requestPath The path to make the request
   * @param {string} method The HTTP method to use.
   * @param {Object} body The body of the request.
   * @return {Promise} A promise that resolves to the response.
  */
  function _makeLeafRequest(requestPath, method, body) {
    return new Promise(function(resolve, reject) {
      let requestOptions = {
        uri: _hubAddress + requestPath,
        method: method,
        json: true,
        agent: false,
      };
      if (body) {
        requestOptions.body = body;
      }

      request(requestOptions, function(error, response, respBody) {
        if (error) {
          reject(error);
          return;
        }
        if (response &&
            response.statusCode !== 200 && response.statusCode !== 204) {
              reject(new Error('Bad statusCode: ' + response.statusCode));
              return;
        }
        if (respBody && respBody.error) {
          reject(new Error('Response Error: ' + respBody));
          return;
        }
        if (requestPath !== '') {
          _getState();
        }
        resolve(respBody);
      });
    });
  }

  /**
   * Validates an integer input.
   *
   * @param {Number} value The value to validate.
   * @param {Number} min The minimum value for the value.
   * @param {Number} max The maximum value for the value.
   * @param {String} label The label to use in error output.
   * @return {Number} The validated integer or null if it failed.
  */
  function _validateInput(value, min, max, label) {
    try {
      let val = parseInt(value, 10);
      if (val < min || val > max) {
        log.error(LOG_PREFIX, `${label} out of range.`);
        return null;
      }
      return val;
    } catch (ex) {
      log.error(LOG_PREFIX, 'Brightness must be an integer.');
      return null;
    }
  }

  /**
   * Get current leaf state
   *
   * @return {Promise} A promise that resolves to the current leaf state
  */
  function _getState() {
    return _makeLeafRequest('', 'GET', null)
    .catch(function(err) {
      log.error(LOG_PREFIX, err.message);
    })
    .then((resp) => {
      // Has the state changed since last time?
      if (diff(_state, resp)) {
        _state = resp;
        let eventName = 'state';
        // If we weren't ready before, change to ready & fire ready event
        if (_ready === false) {
          _ready = true;
          eventName = 'ready';
        }
        _announce(eventName, resp);
      }
      return resp;
    });
  }

  /**
   * Turns the NanoLeaf on/off.
   *   PUT /api/v1/auth_token/state {"on": {"value": true}}
   *
   * @param {Boolean} turnOn On/Off.
   * @return {Promise} A promise that resolves to the response.
  */
  function _setPower(turnOn) {
    log.info(LOG_PREFIX, `setPower(${turnOn})`);
    return new Promise(function(resolve, reject) {
      if (_isReady() !== true) {
        reject(new Error('not_ready'));
        return;
      }
      let body = {on: turnOn};
      resolve(_makeLeafRequest('state', 'PUT', body));
    });
  }

  /**
   * Sets the current effect.
   *   PUT /api/v1/auth_token/effects {"select": "Pete1"}
   *
   * @param {string} effectName Effect name.
   * @return {Promise} A promise that resolves to the response.
  */
  function _setEffect(effectName) {
    log.info(LOG_PREFIX, `setEffect(${effectName})`);
    if (effectName === 'OFF') {
      return _setPower(false);
    }
    return new Promise(function(resolve, reject) {
      if (_isReady() === false) {
        reject(new Error('not_ready'));
        return;
      }
      let body = {select: effectName};
      resolve(_makeLeafRequest('effects', 'PUT', body));
    });
  }

  /**
   * Sets the brightness.
   *   PUT /api/v1/auth_token/state {"brightness": {"value": 100}}
   *
   * @param {Number} level Brightness level.
   * @return {Promise} A promise that resolves to the response.
  */
  function _setBrightness(level) {
    log.info(LOG_PREFIX, `setBrightness(${level})`);
    return new Promise(function(resolve, reject) {
      if (_isReady() === false) {
        reject(new Error('not_ready'));
        return;
      }
      level = _validateInput(level, 0, 100, 'Brightness');
      if (!level) {
        reject(new Error('value_out_of_range'));
        return;
      }
      let body = {brightness: {value: level}};
      resolve(_makeLeafRequest('state', 'PUT', body));
    });
  }

  /**
   * Sets the color temperature.
   *   PUT /api/v1/auth_token/state {"ct": {"value": 100}}
   *
   * @param {Number} ct Color temperature.
   * @return {Promise} A promise that resolves to the response.
  */
  function _setColorTemperature(ct) {
    log.info(LOG_PREFIX, `setColorTemperature(${ct})`);
    return new Promise(function(resolve, reject) {
      if (_isReady() === false) {
        reject(new Error('not_ready'));
        return;
      }
      ct = _validateInput(ct, 1200, 6500, 'Color Temperature');
      if (!ct) {
        reject(new Error('value_out_of_range'));
        return;
      }
      let body = {ct: {value: ct}};
      resolve(_makeLeafRequest('state', 'PUT', body));
    });
  }

  /**
   * Sets the hue and saturation.
   *   PUT /api/v1/auth_token/state {"hue": {"value": 100}}
   *   PUT /api/v1/auth_token/state {"sat": {"value": 100}}
   *
   * @param {Number} hue Hue.
   * @param {Number} sat Saturation
   * @return {Promise} A promise that resolves to the response.
  */
  function _setHueAndSat(hue, sat) {
    log.info(LOG_PREFIX, `setHueAndSat(${hue, sat})`);
    return new Promise(function(resolve, reject) {
      if (_isReady() === false) {
        reject(new Error('not_ready'));
        return;
      }
      hue = _validateInput(hue, 0, 359, 'Hue');
      sat = _validateInput(sat, 0, 100, 'Sat');
      if (!hue || !sat) {
        reject(new Error('value_out_of_range'));
        return;
      }
      let body = {hue: {value: hue}};
      _makeLeafRequest('state', 'PUT', body)
      .then(() => {
        let body = {sat: {value: sat}};
        resolve(_makeLeafRequest('state', 'PUT', body));
      });
    });
  }

  _init();
}

util.inherits(NanoLeaf, EventEmitter);

module.exports = NanoLeaf;
