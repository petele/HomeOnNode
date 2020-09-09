'use strict';

/* node14_ready */

const util = require('util');
const log = require('./SystemLog2');
const fetch = require('node-fetch');
const diff = require('deep-diff').diff;
const honHelpers = require('./HoNHelpers');
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
  let _connectionStarted = false;

  /**
   * Connect to a NanoLeaf light for the first time.
   *
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
      await _getState();
    } catch (ex) {
      if (retry) {
        _retryInitialConnection(retry);
      } else {
        _connectionStarted = false;
      }
      return false;
    }
    log.debug(LOG_PREFIX, 'Connected.');
    _ready = true;
    setInterval(async () => {
      await _getState();
    }, REFRESH_INTERVAL);
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

    if (command.hasOwnProperty('power')) {
      return _setPower(command.power);
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
  async function _makeLeafRequest(requestPath, method, body) {
    const msg = `makeLeafRequest('${method}', '${requestPath}')`;
    let url = _hubAddress + requestPath;
    if (requestPath === 'new') {
      url = `http://${ip}:${port}/api/v1/new`;
    }
    const fetchOpts = {
      method: method,
      headers: {},
    };
    if (body) {
      fetchOpts.body = JSON.stringify(body);
      fetchOpts.headers['Content-Type'] = 'application/json';
    }
    log.verbose(LOG_PREFIX, msg, body);
    const resp = await fetch(url, fetchOpts);

    if (!resp.ok) {
      log.error(LOG_PREFIX, `${msg} - Response error`, resp);
      throw new Error('Response Error');
    }

    if (requestPath !== '') {
      _getState();
    }

    const respBody = await resp.text();
    if (respBody.length === 0) {
      return {ok: true};
    }

    return JSON.parse(respBody);
  }

  /**
   * Get current leaf state
   *
   * @return {Promise} A promise that resolves to the current leaf state
  */
  async function _getState() {
    const state = await _makeLeafRequest('', 'GET');
    if (!state) {
      log.error(LOG_PREFIX, 'No state available.');
      return;
    }
    if (diff(_state, state)) {
      _state = state;
      _self.emit('state_changed', state);
    }
    return _state;
  }

  /**
   * Turns the NanoLeaf on/off.
   *   PUT /api/v1/auth_token/state {"on": {"value": true}}
   *
   * @param {Boolean} val On/Off.
   * @return {Promise} A promise that resolves to the response.
  */
  function _setPower(val) {
    const msg = `setPower(${val})`;
    log.debug(LOG_PREFIX, msg);
    const body = {on: {value: val}};
    return _makeLeafRequest('state', 'PUT', body)
        .catch((err) => {
          log.error(LOG_PREFIX, 'Unable to set state', err);
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
    const msg = `setEffect('${effectName}')`;
    if (effectName === 'OFF') {
      return _setPower(false);
    }
    log.debug(LOG_PREFIX, msg);
    const body = {select: effectName};
    return _makeLeafRequest('effects', 'PUT', body)
        .catch((err) => {
          log.error(LOG_PREFIX, 'Unable to set effect', err);
        });
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
    level = honHelpers.isValidInt(level, 0, 100);
    if (level === null) {
      log.error(LOG_PREFIX, `${msg} failed, value out of range`);
      return Promise.reject(new RangeError('value_out_of_range'));
    }
    const body = {brightness: {value: level}};
    return _makeLeafRequest('state', 'PUT', body)
        .catch((err) => {
          log.error(LOG_PREFIX, 'Unable to set brightness', err);
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
    const msg = `setColorTemperature(${ct})`;
    log.debug(LOG_PREFIX, msg);
    ct = honHelpers.isValidInt(ct, 1200, 6500);
    if (ct === null) {
      log.error(LOG_PREFIX, `${msg} failed, value out of range`);
      return Promise.reject(new RangeError('value_out_of_range'));
    }
    const body = {ct: {value: ct}};
    return _makeLeafRequest('state', 'PUT', body)
        .catch((err) => {
          log.error(LOG_PREFIX, 'Unable to set color temperature', err);
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
    const msg = `setHueAndSat(${hue}, ${sat})`;
    log.debug(LOG_PREFIX, msg);
    hue = honHelpers.isValidInt(hue, 0, 359);
    sat = honHelpers.isValidInt(sat, 0, 100);
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
}

util.inherits(NanoLeaf, EventEmitter);

module.exports = NanoLeaf;
