'use strict';

const util = require('util');
const log = require('./SystemLog2');
const fetch = require('node-fetch');
const Keys = require('./Keys').keys;
const diff = require('deep-diff').diff;
const FBHelper = require('./FBHelper');
const honHelpers = require('./HoNHelpers');
const EventEmitter = require('events').EventEmitter;

const LOG_PREFIX = 'G_DEVICE_ACCESS';

const VALID_MODES = ['HEAT', 'COOL', 'OFF'];

/**
 * Google Device Access API.
 * @constructor
 *
 * @see https://developers.google.com/nest/device-access/
 *
 * @param {Object} credentials
 *
*/
function GDeviceAccess() {
  const REQUEST_TIMEOUT = 15 * 1000;
  const DEVICE_REFRESH_INTERVAL = 90 * 1000;
  const STRUCTURE_REFRESH_INTERVAL = 4 * 60 * 1000;
  const _projectID = Keys.gDeviceAccess?.projectID;
  const _clientID = Keys.gDeviceAccess?.clientID;
  const _clientSecret = Keys.gDeviceAccess?.clientSecret;
  const _refreshToken = Keys.gDeviceAccess?.refreshToken;
  const _basePath = `https://smartdevicemanagement.googleapis.com/` +
      `v1/enterprises/${_projectID}`;

  let _ready = false;

  const _state = {};
  const _roomLookUp = {};

  let _accessToken;
  let _accessTokenExpiresAt = 0;

  const _self = this;

  /**
   *
   */
  async function _init() {
    log.init(LOG_PREFIX, 'Starting...');

    if (!_projectID || !_clientID || !_clientSecret || !_refreshToken) {
      log.error(LOG_PREFIX, 'Missing key info', Keys.gDeviceAccess);
      return;
    }

    const fbRootRef = await FBHelper.getRootRefUnlimited();
    const configPath = 'config/HomeOnNode/googleDeviceAccess/thermostats';
    const fbConfig = await fbRootRef.child(configPath);
    const config = await fbConfig.once('value');
    const rooms = config.val();
    Object.keys(rooms).forEach((roomId) => {
      const deviceId = rooms[roomId];
      _roomLookUp[roomId] = deviceId;
      _roomLookUp[deviceId] = roomId;
    });

    await _getAccessToken();
    _ready = true;
    _self.emit('ready');

    await _getHomeInfo();
    await _getDeviceInfo();

    setInterval(() => {
      _getDeviceInfo();
    }, DEVICE_REFRESH_INTERVAL);
    setInterval(() => {
      _getHomeInfo();
    }, STRUCTURE_REFRESH_INTERVAL);
  }

  /**
   * Refreshes the details of the connected devices.
   *
   * @param {Number} [delay] Number of MS to delay the request.
   */
  async function _getHomeInfo(delay) {
    if (delay) {
      await honHelpers.sleep(delay);
    }
    const structures = await _sendRequest('structures', 'GET', null, true);
    if (diff(_state.structure, structures.structures[0])) {
      _state.structure = structures.structures[0];
      _self.emit('structure_changed', structures.structures[0]);
    }
  }

  /**
   * Refreshes the details of the conntected devices.
   *
   * @param {Number} delay Number of MS to delay the request
   */
  async function _getDeviceInfo(delay) {
    if (delay) {
      await honHelpers.sleep(delay);
    }
    const devices = await _sendRequest('devices', 'GET', null, true);
    if (diff(_state.devices, devices)) {
      _state.devices = devices;
      _self.emit('devices_changed', devices);
    }
  }


  /**
   * Executes a Device Access command
   *
   * @param {Object} command Command to execute.
   * @return {Object} result of executed command
   */
  this.executeCommand = function(command) {
    // Ensure we're connected
    if (_ready !== true) {
      log.error(LOG_PREFIX, `Not ready`);
      return Promise.reject(new Error('Not Ready'));
    }

    // Get & validate the action & value
    const action = command.action;
    const room = command.room;
    const value = command.value;
    if (!action) {
      return Promise.reject(new Error(`No 'action' provided.`));
    }

    log.verbose(LOG_PREFIX, `executeCommand('${action}')`, command);

    // Run the commands
    if (action === 'setTemperature') {
      log.log(LOG_PREFIX, `Set the ${room} temperature to ${value}.`);
      return _setTemperature(room, value);
    }
    if (action === 'setHVACMode') {
      log.log(LOG_PREFIX, `Set the ${room} thermostat to ${value}.`);
      return _setHVACMode(room, value);
    }

    return Promise.reject(new Error(`Unknown command: '${action}'`));
  };


  /**
   * Set the temperature in a room.
   *
   * @param {String} roomId LR/BR
   * @param {Number} temperature Temperature in F
   * @return {Promise}
   */
  async function _setTemperature(roomId, temperature) {
    const deviceId = _roomLookUp[roomId];

    if (!deviceId) {
      log.error(LOG_PREFIX, 'Unable to find matching device ID', roomId);
      throw new Error('Invalid room ID');
    }

    const reqPath = `devices/${deviceId}`;
    const current = await _sendRequest(reqPath, 'GET', null, true);
    const cMode = current.traits['sdm.devices.traits.ThermostatMode'].mode;

    const body = {
      command: 'sdm.devices.commands.ThermostatTemperatureSetpoint',
      params: {},
    };

    if (cMode === 'HEAT') {
      body.command += '.SetHeat';
      body.params.heatCelsius = _convertFtoC(temperature);
    } else if (cMode === 'COOL') {
      body.command += '.SetCool';
      body.params.coolCelsius = _convertFtoC(temperature);
    } else {
      throw new Error('Invalid Mode');
    }

    const reqPathExec = `${reqPath}:executeCommand`;
    const result = await _sendRequest(reqPathExec, 'POST', body, true);
    _getHomeInfo(250);
    return result;
  }

  /**
   * Set the HVAC mode for a thermostat to a specific mode.
   *
   * @param {String} roomId LR/BR
   * @param {String} mode HEAT/COOL/OFF
   * @return {Promise}
   */
  async function _setHVACMode(roomId, mode) {
    const deviceId = _roomLookUp[roomId];

    if (!deviceId) {
      log.error(LOG_PREFIX, 'Unable to find matching device ID', roomId);
      throw new Error('Invalid room ID');
    }

    if (!VALID_MODES.includes(mode)) {
      log.error(LOG_PREFIX, 'Invalid HVAC mode', mode);
      throw new Error('Invalid Mode');
    }

    const reqPath = `devices/${deviceId}:executeCommand`;
    const body = {
      command: 'sdm.devices.commands.ThermostatMode.SetMode',
      params: {
        mode: mode,
      },
    };
    const result = await _sendRequest(reqPath, 'POST', body, true);
    _getHomeInfo(250);
    return result;
  }

  /**
   * Convert a temperture from F to C
   *
   * @param {Number} val Temperature in F
   * @return {Number} Temperature in Celcius.
   */
  function _convertFtoC(val) {
    return (val - 32) * 5 / 9;
  }

  /**
   * Attempt to get a new access token.
   *
   * @return {String} accessToken
   */
  async function _getAccessToken() {
    const now = Date.now();
    if (_accessToken && _accessTokenExpiresAt > now) {
      return _accessToken;
    }
    const url = `https://www.googleapis.com/oauth2/v4/token?` +
        `client_id=${_clientID}&` +
        `client_secret=${_clientSecret}&` +
        `refresh_token=${_refreshToken}&` +
        `grant_type=refresh_token`;
    try {
      log.log(LOG_PREFIX, 'Getting new access token...', _accessToken);
      const resp = await fetch(url, {method: 'POST'});
      if (resp.ok) {
        const body = await resp.json();
        _accessToken = body.access_token;
        _accessTokenExpiresAt = now + (body.expires_in * 1000);
        return _accessToken;
      }
    } catch (ex) {
      log.error(LOG_PREFIX, 'Unable to get access token', ex);
      return null;
    }
  }

  /**
   * Helper function to make an HTTP request
   *
   * @param {String} requestPath the URL/request path to hit
   * @param {String} method the HTTP method to use
   * @param {Object} [body] The body to send along with the request
   * @param {Boolean} [retry] If the request fails, should it retry
   * @return {Promise} A promise that resolves with the response
   */
  async function _sendRequest(requestPath, method, body, retry) {
    const url = `${_basePath}/${requestPath}`;
    const msg = `makeRequest('${requestPath}', '${method}', ${retry})`;
    const accessToken = await _getAccessToken();
    if (!accessToken) {
      log.error(LOG_PREFIX, 'Unable to make request, no access token');
      throw new Error('No access_token');
    }
    const fetchOpts = {
      method: method || 'GET',
      timeout: REQUEST_TIMEOUT,
      headers: {
        'Authorization': `Bearer ${accessToken}`,
      },
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
      if (retry) {
        log.verbose(LOG_PREFIX, `${msg} - Request error (will retry)`, ex);
        await honHelpers.sleep(250);
        return _sendRequest(requestPath, method, body, false);
      }
      log.error(LOG_PREFIX, `${msg} - Request error`, ex);
      throw ex;
    }

    if (!resp.ok) {
      log.error(LOG_PREFIX, `${msg} - Response error`, resp);
      if (retry) {
        await honHelpers.sleep(250);
        return _sendRequest(requestPath, method, body, false);
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
        return _sendRequest(requestPath, method, body, false);
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
      return _sendRequest(requestPath, method, body, false);
    }

    log.error(LOG_PREFIX, `${msg} - will retry.`, errors);
    throw new Error('Failed');
  }

  _init();
}

util.inherits(GDeviceAccess, EventEmitter);

module.exports = GDeviceAccess;
