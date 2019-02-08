'use strict';

const util = require('util');
const request = require('request');
const log = require('./SystemLog2');
const diff = require('deep-diff').diff;
const EventEmitter = require('events').EventEmitter;

const LOG_PREFIX = 'NANOLEAF';

/**
 * NanoLeaf API.
 * @constructor
 *
 * @see http://forum.nanoleaf.me/docs/openapi
 * @fires NanoLeaf#state_changed
 * @property {Object} state Current state of the NanoLeaf
 * @param {String} key Authentication key.
 * @param {String} ip IP address of the hub.
 * @param {String} port Port of the hub.
*/
function NanoLeaf(key, ip, port) {
  const _hubAddress = `http://${ip}:${port}/api/v1/${key}/`;
  const REFRESH_INTERVAL = 110 * 1000;
  const _self = this;
  let _ready = false;
  let _state = {};
  this.state = _state;

  /**
   * Execute a NanoLeaf command.
   *
   * @param {Object} command The command to run.
   * @return {Promise} The promise that will be resolved on completion.
  */
  this.executeCommand = function(command) {
    if (!_isReady()) {
      log.error(LOG_PREFIX, `Command failed, not ready.`, command);
      return Promise.reject(new Error('not_ready'));
    }

    if (command.hasOwnProperty('authorize')) {
      return _makeLeafRequest('new', 'POST')
        .then((resp) => {
          log.log(LOG_PREFIX, resp);
          return resp;
        });
    }

    if (command.hasOwnProperty('cycleEffect')) {
      return _cycleEffect();
    }

    const promises = [];
    if (command.hasOwnProperty('brightness')) {
      promises.push(_setBrightness(command.brightness));
    }

    if (command.hasOwnProperty('effect')) {
      promises.push(_setEffect(command.effect));
    } else if (command.hasOwnProperty('colorTemp')) {
      promises.push(_setColorTemperature(command.colorTemp));
    } else if (command.hasOwnProperty('hue') && command.hasOwnProperty('sat')) {
      promises.push(_setHueAndSat(command.hue, command.sat));
    }

    if (promises.length === 0) {
      return Promise.reject(new TypeError('unknown_command'));
    } else {
      return Promise.all(promises);
    }
  };

  /**
   * Init
  */
  function _init() {
    log.init(LOG_PREFIX, 'Starting...', {ip: ip, port: port});
    _getState();
    setInterval(_getState, REFRESH_INTERVAL);
  }

  /**
   * Checks if system is ready
   *
   * @return {Boolean} true if system is ready, false if not.
  */
  function _isReady() {
    return _ready === true;
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
      const msg = `makeLeafRequest('${method}', '${requestPath}')`;
      let requestOptions = {
        uri: _hubAddress + requestPath,
        method: method,
        agent: false,
        json: true,
      };
      if (requestPath === 'new') {
        requestOptions.uri = `http://${ip}:${port}/api/v1/new`;
      }
      if (body) {
        requestOptions.body = body;
      }
      log.verbose(LOG_PREFIX, msg, body);
      request(requestOptions, (error, response, respBody) => {
        if (error) {
          log.error(LOG_PREFIX, 'Request error', error);
          reject(error);
          return;
        }
        log.verbose(LOG_PREFIX, `${msg}: ${response.statusCode}`);
        if (response &&
            response.statusCode !== 200 && response.statusCode !== 204) {
              const m = `Invalid status code: ${response.statusCode}`;
              log.error(LOG_PREFIX, m, respBody);
              reject(new Error(`status_${response.statusCode}`));
              return;
        }
        if (respBody && respBody.error) {
          log.error(LOG_PREFIX, `Response error`, respBody);
          reject(new Error('response_error'));
          return;
        }
        if (requestPath !== '') {
          _getState();
        }
        resolve({statusCode: response.statusCode, body: respBody});
      });
    });
  }

  /**
   * Validates an integer input.
   *
   * @param {Number} value The value to validate.
   * @param {Number} min The minimum value for the value.
   * @param {Number} max The maximum value for the value.
   * @return {Number} The validated integer or null if it failed.
  */
  function _validateInput(value, min, max) {
    try {
      const val = parseInt(value, 10);
      if (val < min || val > max) {
        return null;
      }
      return val;
    } catch (ex) {
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
        return {error: err};
      })
      .then((resp) => {
        if (resp.error) {
          // Bail, we've already logged the error above.
          return;
        }
        let state = resp.body;
        // Has the state changed since last time?
        if (diff(_state, state)) {
          _state = state;
          // If we weren't ready before, change to ready & fire ready event
          if (_ready === false) {
            log.debug(LOG_PREFIX, 'Ready.');
            _ready = true;
          }
          /**
           * State has changed
           * @event NanoLeaf#state_changed
           */
          _self.emit('state_changed', state);
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
    const msg = `setPower(${turnOn})`;
    log.debug(LOG_PREFIX, msg);
    const body = {on: turnOn};
    return _makeLeafRequest('state', 'PUT', body);
  }

  /**
   * Sets the current effect.
   *   PUT /api/v1/auth_token/effects {"select": "Pete1"}
   *
   * @param {string} effectName Effect name.
   * @return {Promise} A promise that resolves to the response.
  */
  function _setEffect(effectName) {
    const msg = `setEffect('${effectName}')`;
    if (effectName === 'OFF') {
      return _setPower(false);
    }
    log.debug(LOG_PREFIX, msg);
    const body = {select: effectName};
    return _makeLeafRequest('effects', 'PUT', body);
  }

  /**
   * Cycles to the next effect.
   *
   * @return {Promise} A promise that resolves to the response.
  */
  function _cycleEffect() {
    const msg = `cycleEffect()`;
    log.debug(LOG_PREFIX, msg);
    try {
      const effects = _state.effects.effectsList;
      let index = effects.indexOf(_state.effects.select) + 1;
      if (index >= effects.length) {
        index = 0;
      }
      const newEffect = effects[index];
      return _setEffect(newEffect);
    } catch (ex) {
      log.exception(LOG_PREFIX, `${msg} failed.`, ex);
      return Promise.reject(ex);
    }
  }


  /**
   * Sets the brightness.
   *   PUT /api/v1/auth_token/state {"brightness": {"value": 100}}
   *
   * @param {Number} level Brightness level.
   * @return {Promise} A promise that resolves to the response.
  */
  function _setBrightness(level) {
    const msg = `setBrightness(${level})`;
    log.debug(LOG_PREFIX, msg);
    level = _validateInput(level, 0, 100);
    if (level === null) {
      log.error(LOG_PREFIX, `${msg} failed, value out of range`);
      return Promise.reject(new RangeError('value_out_of_range'));
    }
    const body = {brightness: {value: level}};
    return _makeLeafRequest('state', 'PUT', body);
  }

  /**
   * Sets the color temperature.
   *   PUT /api/v1/auth_token/state {"ct": {"value": 100}}
   *
   * @param {Number} ct Color temperature.
   * @return {Promise} A promise that resolves to the response.
  */
  function _setColorTemperature(ct) {
    const msg = `setColorTemperature(${ct})`;
    log.debug(LOG_PREFIX, msg);
    ct = _validateInput(ct, 1200, 6500);
    if (ct === null) {
      log.error(LOG_PREFIX, `${msg} failed, value out of range`);
      return Promise.reject(new RangeError('value_out_of_range'));
    }
    const body = {ct: {value: ct}};
    return _makeLeafRequest('state', 'PUT', body);
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
    const msg = `setHueAndSat(${hue}, ${sat})`;
    log.debug(LOG_PREFIX, msg);
    hue = _validateInput(hue, 0, 359);
    sat = _validateInput(sat, 0, 100);
    if (hue === null || sat === null) {
      log.error(LOG_PREFIX, `${msg} failed, value out of range`);
      return Promise.reject(new RangeError('value_out_of_range'));
    }
    const body = {
      hue: {value: hue},
      sat: {value: sat},
    };
    return _makeLeafRequest('state', 'PUT', body);
  }

  _init();
}

util.inherits(NanoLeaf, EventEmitter);

module.exports = NanoLeaf;
