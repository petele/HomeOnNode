'use strict';

const util = require('util');
const log = require('./SystemLog2');
const fetch = require('node-fetch');
const Keys = require('./Keys').keys;
const diff = require('deep-diff').diff;
const FBHelper = require('./FBHelper');
const honHelpers = require('./HoNHelpers');
// const {PubSub} = require('@google-cloud/pubsub');
const EventEmitter = require('events').EventEmitter;

const LOG_PREFIX = 'G_DEVICE_ACCESS';

const VALID_MODES = ['HEAT', 'COOL', 'OFF'];

/**
 * Google Device Access API.
 * @constructor
 *
 * @see https://developers.google.com/nest/device-access/
 *
 */
function GDeviceAccess() {
  const REQUEST_TIMEOUT = 15 * 1000;
  const DEVICE_REFRESH_INTERVAL = 67 * 1000;
  const STRUCTURE_REFRESH_INTERVAL = 4 * 60 * 1000;

  let _ready = false;
  const _self = this;
  const _projectID = Keys.gDeviceAccess?.projectID;
  const _clientID = Keys.gDeviceAccess?.clientID;
  const _clientSecret = Keys.gDeviceAccess?.clientSecret;
  const _refreshToken = Keys.gDeviceAccess?.refreshToken;
  const _basePath = `https://smartdevicemanagement.googleapis.com/` +
      `v1/enterprises/${_projectID}`;

  const _state = {
    defaultHVACMode: 'OFF',
    devices: {},
  };
  const _thermostatLookUp = {};

  let _accessToken;
  let _accessTokenExpiresAt = 0;


  /**
   * Basic init
   */
  async function _init() {
    log.init(LOG_PREFIX, 'Starting...');

    if (!_projectID || !_clientID || !_clientSecret || !_refreshToken) {
      log.error(LOG_PREFIX, 'Missing key info', Keys.gDeviceAccess);
      return;
    }

    const fbConfigBase = `config/HomeOnNode/googleDeviceAccess`;
    const fbRootRef = await FBHelper.getRootRefUnlimited();

    // Get the default HVAC mode
    const fbThermDefModePath = `${fbConfigBase}/defaultHVACMode`;
    const fbThermDefaultModeRef = await fbRootRef.child(fbThermDefModePath);
    fbThermDefaultModeRef.on('value', (snapshot) => {
      let value = snapshot.val();
      value = value.toUpperCase();
      log.log(LOG_PREFIX, `Default HVAC mode set to '${value}'`);
      _state.defaultHVACMode = value;
    });

    // Get the thermostat key mapping
    const cfgThermoKeyMapPath = `${fbConfigBase}/thermostats`;
    const fbThermKeyMapPath = await fbRootRef.child(cfgThermoKeyMapPath);
    const thermKeyMapRef = await fbThermKeyMapPath.once('value');
    const thermKeyMap = thermKeyMapRef.val();
    Object.keys(thermKeyMap).forEach((roomId) => {
      const deviceId = thermKeyMap[roomId];
      _thermostatLookUp[roomId] = deviceId;
      _thermostatLookUp[deviceId] = roomId;
    });

    // Attempt to connect to Google Servers
    _connect();
  }

  /**
   * Connect to Google servers...
   */
  async function _connect() {
    const token = await _getAccessToken();
    if (!token) {
      await honHelpers.sleep(30 * 1000);
      return _connect();
    }

    _ready = true;
    _self.emit('ready');

    await _getHomeInfo();
    await _getDeviceInfo();

    // _initPubSub();

    setInterval(() => {
      _getDeviceInfo();
    }, DEVICE_REFRESH_INTERVAL);
    setInterval(() => {
      _getHomeInfo();
    }, STRUCTURE_REFRESH_INTERVAL);
  }

  // /**
  //  *
  //  */
  // async function _initPubSub() {
  //   console.log(1);
  //   const subscriptionName = 'hon-events';
  //   const pubSubClient = new PubSub({projectId: 'petele-home-automation'});
  //   const subscription = pubSubClient.subscription(subscriptionName);

  //   // const subscription = pubSubClient.subscription(subscriptionName);
  //   // console.log(2);
  //   subscription.on('message', (message) => {
  //     console.log(`Received message ${message.id}:`);
  //     console.log(`\tData: ${message.data}`);
  //     console.log(`\tAttributes: ${message.attributes}`);
  //     message.ack();
  //   });
  // }

  /**
   * Refreshes the details of the connected devices.
   *
   * @param {Number} [delay] Number of MS to delay the request.
   */
  async function _getHomeInfo(delay) {
    if (delay) {
      await honHelpers.sleep(delay);
    }
    try {
      const structures = await _sendRequest('structures', 'GET', null, true);
      _parseStructure(structures.structures[0]);
    } catch (ex) {
      log.error(LOG_PREFIX, 'Unable to update home info', ex);
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
    try {
      const devices = await _sendRequest('devices', 'GET', null, true);
      devices.devices.forEach((device) => {
        _parseDevice(device);
      });
    } catch (ex) {
      log.error(LOG_PREFIX, 'Unable to update device info', ex);
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

    // Run the commands
    if (action === 'setTemperature') {
      return _setTemperature(room, value);
    }
    if (action === 'setHVACMode') {
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
    const msg = `setTemperature('${roomId}', ${temperature})`;
    log.log(LOG_PREFIX, msg);

    const deviceId = _thermostatLookUp[roomId];

    if (!deviceId) {
      log.error(LOG_PREFIX, `${msg} - failed, unable to find deviceId`);
      throw new Error(`Unknown roomID: '${roomId}'`);
    }

    const reqPath = `devices/${deviceId}`;
    const current = await _sendRequest(reqPath, 'GET', null, true);
    let cMode = current.traits['sdm.devices.traits.ThermostatMode'].mode;

    if (cMode === 'OFF' && _state.defaultHVACMode === 'OFF') {
      log.warn(LOG_PREFIX, `${msg} - failed, mode is 'OFF'`);
      throw new Error(`HVAC mode is 'OFF'`);
    }

    if (cMode === 'OFF') {
      const newVal = _state.defaultHVACMode;
      const msgChgMode = `HVAC in '${roomId}' is off, changing to '${newVal}'`;
      try {
        log.debug(LOG_PREFIX, msgChgMode);
        await _setHVACMode(roomId, newVal);
        cMode = newVal;
      } catch (ex) {
        log.warn(LOG_PREFIX, `${msgChgMode} - failed.`, ex);
        throw new Error('Could Not Change Mode');
      }
    }

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
      throw new Error(`Unknown Mode: '${cMode}'`);
    }

    const reqPathExec = `${reqPath}:executeCommand`;
    const result = await _sendRequest(reqPathExec, 'POST', body, true);
    _getDeviceInfo(250);
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
    const msg = `setHVACMode('${roomId}', '${mode}')`;
    log.log(LOG_PREFIX, msg);

    const deviceId = _thermostatLookUp[roomId];

    if (!deviceId) {
      log.error(LOG_PREFIX, `${msg} - failed, deviceID not found: '${roomId}'`);
      throw new Error(`Unknown roomID: '${roomId}'`);
    }

    if (!VALID_MODES.includes(mode)) {
      log.error(LOG_PREFIX, `${msg} - failed, unknown HVAC mode: '${mode}'`);
      throw new Error(`Unknown Mode: '${mode}'`);
    }

    const reqPath = `devices/${deviceId}:executeCommand`;
    const body = {
      command: 'sdm.devices.commands.ThermostatMode.SetMode',
      params: {
        mode: mode,
      },
    };
    const result = await _sendRequest(reqPath, 'POST', body, true);
    _getDeviceInfo(250);
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
   * Parse and create a structure item.
   *
   * @param {Object} structure Structure object from Device Access API
   */
  function _parseStructure(structure) {
    try {
      const id = structure.name.substring(structure.name.lastIndexOf('/') + 1);
      const name = structure.traits['sdm.structures.traits.Info'].customName;
      const parsedStruct = {id, name};
      if (diff(_state.structure, parsedStruct)) {
        _state.structure = parsedStruct;
        _self.emit('structure_changed', parsedStruct);
      }
    } catch (ex) {
      log.error(LOG_PREFIX, 'Unable to parse structure object', ex);
    }
  }

  /**
   * Parse and create a device item.
   *
   * @param {Object} device Object from Device Access API
   */
  function _parseDevice(device) {
    const id = device.name.substring(device.name.lastIndexOf('/') + 1);
    const fullType = device.type;
    const shortType = fullType
        .substring(fullType.lastIndexOf('.') + 1)
        .toLowerCase();
    const inRoom = device.parentRelations[0].displayName;
    const result = {
      id,
      type: {
        full: fullType,
        short: shortType,
      },
      inRoom,
      traits: {},
    };
    Object.keys(device.traits).forEach((key) => {
      try {
        const traitName = _getTraitName(key);
        result.traits[traitName] = device.traits[key];
      } catch (ex) {
        const extra = device.traits[key];
        log.error(LOG_PREFIX, `Unable to set trait for '${key}'`, extra);
      }
    });
    if (diff(_state.devices[id], result)) {
      _state.devices[id] = result;
      _self.emit('device_changed', result);
    }
  }

  /**
   * Simplify and camel case the trait name.
   *
   * @param {String} traitName Trait name from API
   * @return {String}
   */
  function _getTraitName(traitName) {
    const startAt = traitName.lastIndexOf('.') + 1;
    const result = traitName.substring(startAt + 1);
    return traitName.substring(startAt, startAt + 1).toLowerCase() + result;
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
    }
    return null;
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
      const extra = {
        statusCode: resp.status,
      };
      try {
        extra.body = await resp.text();
        extra.body = JSON.parse(extra.body);
      } catch (ex) {
        // Do nothing.
      }
      log.error(LOG_PREFIX, `${msg} - Response error`, extra);
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

    if (respBody.error) {
      log.verbose(LOG_PREFIX, `${msg} Response error: body.`, respBody);
      if (retry) {
        log.warn(LOG_PREFIX, `${msg} - will retry.`, respBody.error);
        await honHelpers.sleep(250);
        return _sendRequest(requestPath, method, body, false);
      }
      throw new Error('Failed');
    }

    return respBody;
  }

  _init();
}

util.inherits(GDeviceAccess, EventEmitter);

module.exports = GDeviceAccess;
