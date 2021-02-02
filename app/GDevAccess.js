'use strict';

const util = require('util');
const https = require('https');
const log = require('./SystemLog2');
const fetch = require('node-fetch');
const Keys = require('./Keys').keys;
const diff = require('deep-diff').diff;
const FBHelper = require('./FBHelper');
const honHelpers = require('./HoNHelpers');
const {PubSub} = require('@google-cloud/pubsub');
const EventEmitter = require('events').EventEmitter;

const LOG_PREFIX = 'G_DEVICE_ACCESS';

const VALID_MODES = ['HEAT', 'COOL', 'OFF'];

/**
 * Google Device Access API.
 * @constructor
 *
 * @see https://developers.google.com/nest/device-access/
 *
 * After adding a new device to your Nest collection, visit
 * https://nestservices.google.com/partnerconnections
 *
 */
function GDeviceAccess() {
  const REQUEST_TIMEOUT = 15 * 1000;
  const DEVICE_REFRESH_INTERVAL = 30 * 60 * 1001;
  const STRUCTURE_REFRESH_INTERVAL = 45 * 60 * 1003;

  let _ready = false;
  let _homeInfoTimer;
  let _deviceInfoTimer;
  const _self = this;
  const _projectID = Keys.gDeviceAccess?.projectID;
  const _clientID = Keys.gDeviceAccess?.clientID;
  const _clientSecret = Keys.gDeviceAccess?.clientSecret;
  const _refreshToken = Keys.gDeviceAccess?.refreshToken;
  const _basePath = `https://smartdevicemanagement.googleapis.com/` +
      `v1/enterprises/${_projectID}`;

  const _deviceState = {};
  let _defaultHVACMode = 'OFF';
  const _deviceLookup = new Map();

  let _accessToken;
  let _accessTokenExpiresAt = 0;

  const AGENT_OPTS = {
    maxSockets: 2,
    keepAlive: true,
  };
  const _httpAgent = new https.Agent(AGENT_OPTS);

  /**
   * Basic init
   */
  async function _init() {
    log.init(LOG_PREFIX, 'Starting...');

    if (!process.env.GOOGLE_APPLICATION_CREDENTIALS) {
      const msg = `Missing 'GOOGLE_APPLICATION_CREDENTIALS'`;
      log.warn(LOG_PREFIX, `${msg}, using default settings.`);
      process.env.GOOGLE_APPLICATION_CREDENTIALS = 'KeysPubSub.json';
    }

    if (!_projectID || !_clientID || !_clientSecret || !_refreshToken) {
      log.error(LOG_PREFIX, 'Missing key info', Keys.gDeviceAccess);
      return;
    }

    const fbRootRef = await FBHelper.getRootRefUnlimited();
    const fbConfigBase = `config/HomeOnNode`;

    // Get the default HVAC mode
    const fbThermDefModePath = `${fbConfigBase}/hvac/defaultMode`;
    const fbThermDefaultModeRef = await fbRootRef.child(fbThermDefModePath);
    fbThermDefaultModeRef.on('value', (snapshot) => {
      const value = snapshot.val();
      _defaultHVACMode = value.toUpperCase();
      log.log(LOG_PREFIX, `Default HVAC mode set to '${_defaultHVACMode}'`);
    });

    // Get the thermostat key mapping
    const deviceKeyMapPath = `${fbConfigBase}/googleDeviceAccess/deviceKeyMap`;
    const deviceKeyMapFBRef = await fbRootRef.child(deviceKeyMapPath);
    const deviceKeyMapFBSnap = await deviceKeyMapFBRef.once('value');
    const deviceKeyMap = deviceKeyMapFBSnap.val();
    Object.keys(deviceKeyMap).forEach((roomId) => {
      const deviceId = deviceKeyMap[roomId];
      _deviceLookup.set(roomId, deviceId);
      _deviceLookup.set(deviceId, roomId);
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

    const pubSubClient = new PubSub({projectId: 'petele-home-automation'});
    const subscription = pubSubClient.subscription('hon-events');
    subscription.on('message', _handlePubSubMessage);
    subscription.on('error', _handlePubSubError);
    subscription.on('close', _handlePubSubClosed);

    _deviceInfoTimer = setInterval(() => {
      _getDeviceInfo();
    }, DEVICE_REFRESH_INTERVAL);
    _homeInfoTimer = setInterval(() => {
      _getHomeInfo();
    }, STRUCTURE_REFRESH_INTERVAL);
  }

  /**
   * Handle the subscription closed event.
   */
  function _handlePubSubClosed() {
    const msg = `PubSub Subscription Closed.`;
    _ready = false;
    if (_deviceInfoTimer) {
      clearInterval(_deviceInfoTimer);
      _deviceInfoTimer = null;
    }
    if (_homeInfoTimer) {
      clearInterval(_homeInfoTimer);
      _homeInfoTimer = null;
    }
    log.error(LOG_PREFIX, `${msg} Will retry in 5 minutes.`);
    setTimeout(() => {
      _connect();
    }, 5 * 60 * 1000);
  }


  /**
   * Handle incoming PubSub error...
   *
   * @param {Error} err Error
   */
  function _handlePubSubError(err) {
    const msg = `PubSub Error`;
    log.error(LOG_PREFIX, msg, err);
  }

  /**
   * Handle incoming PubSub message about changes to devices...
   *
   * @param {PubSub.message} message
   */
  async function _handlePubSubMessage(message) {
    const msgBase = `PubSub Notification:`;
    const data = JSON.parse(message.data.toString());
    try {
      message.ack();
    } catch (ex) {
      log.error(LOG_PREFIX, `${msgBase} Failed trying to ack message.`, ex);
      return;
    }
    if (!data.hasOwnProperty('resourceUpdate')) {
      // If it doesn't have a resourceUpdate attribute, ignore it.
      log.warn(LOG_PREFIX, `${msgBase} 'unknown' (ignored)`, data);
      return;
    }
    const msgType = data.resourceUpdate.traits ? 'trait' : 'event';
    if (msgType === 'event') {
      // If it's an event, typically from a camera, ignore it.
      log.debug(LOG_PREFIX, `${msgBase} '${msgType}' (ignored)`, data);
      return;
    }
    try {
      const deviceName = data.resourceUpdate.name;
      const deviceId = deviceName.substring(deviceName.lastIndexOf('/') + 1);
      log.debug(LOG_PREFIX, `${msgBase} '${msgType}'`, data);
      const reqPath = `devices/${deviceId}`;
      const device = await _sendRequest(reqPath, 'GET', null, true);
      return _parseDevice(device);
    } catch (ex) {
      log.error(LOG_PREFIX, `${msgBase} '${msgType}' (FAILED)`, ex);
    }
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
    try {
      log.debug(LOG_PREFIX, 'Updating structure info...');
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
      log.debug(LOG_PREFIX, 'Updating devices...');
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
  this.executeCommand = async function(command) {
    // Ensure we're connected
    if (_ready !== true) {
      log.error(LOG_PREFIX, `Not ready`);
      return Promise.reject(new Error('Not Ready'));
    }

    // Get & validate the action & value
    const action = command.action;
    const deviceName = command.deviceName;
    const value = command.value;
    if (!action) {
      return Promise.reject(new Error(`No 'action' provided.`));
    }

    // Run the commands
    if (action === 'setTemperature') {
      return _setTemperature(deviceName, value);
    }
    if (action === 'setHVACMode') {
      return _setHVACMode(deviceName, value);
    }

    return Promise.reject(new Error(`Unknown command: '${action}'`));
  };


  /**
   * Set the temperature in a room.
   *
   * @param {String} deviceName LR/BR
   * @param {Number} temperature Temperature in F
   * @return {Promise}
   */
  async function _setTemperature(deviceName, temperature) {
    const msg = `setTemperature('${deviceName}', ${temperature})`;
    log.log(LOG_PREFIX, msg);

    const deviceId = _deviceLookup.get(deviceName);
    if (!deviceId) {
      log.error(LOG_PREFIX, `${msg} - failed, unable to find deviceId`);
      throw new Error(`Unknown roomID: '${deviceName}'`);
    }

    const reqPath = `devices/${deviceId}`;
    const current = await _sendRequest(reqPath, 'GET', null, true);
    let cMode = current.traits['sdm.devices.traits.ThermostatMode'].mode;

    if (cMode === 'OFF' && _defaultHVACMode === 'OFF') {
      log.warn(LOG_PREFIX, `${msg} - failed, default mode is 'OFF'`);
      throw new Error(`HVAC mode is 'OFF'`);
    }

    if (cMode === 'OFF') {
      const newVal = _defaultHVACMode;
      const msgChgMode = `HVAC '${deviceName}' is off, changing to '${newVal}'`;
      try {
        log.debug(LOG_PREFIX, msgChgMode);
        await _setHVACMode(deviceName, newVal);
        await honHelpers.sleep(5000);
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
    // _getDeviceInfo(250);
    return result;
  }

  /**
   * Set the HVAC mode for a thermostat to a specific mode.
   *
   * @param {String} deviceName LR/BR
   * @param {String} mode HEAT/COOL/OFF
   * @return {Promise}
   */
  async function _setHVACMode(deviceName, mode) {
    const msg = `setHVACMode('${deviceName}', '${mode}')`;
    log.log(LOG_PREFIX, msg);

    const deviceId = _deviceLookup.get(deviceName);
    if (!deviceId) {
      log.error(LOG_PREFIX, `${msg} - failed, '${deviceName}' not found.`);
      throw new Error(`Unknown roomID: '${deviceName}'`);
    }

    if (mode.toUpperCase() === 'ON') {
      mode = _defaultHVACMode;
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
    // _getDeviceInfo(250);
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
      if (diff(_deviceState[id], parsedStruct)) {
        _deviceState[id] = parsedStruct;
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
    const shortType = device.type
        .substring(device.type.lastIndexOf('.') + 1)
        .toLowerCase();
    const roomInfo = _parseRoomInfo(device.parentRelations[0]);
    const result = {
      id,
      type: device.type,
      typeShort: shortType,
      roomId: roomInfo.id,
      roomName: roomInfo.name,
      traits: {},
    };
    Object.keys(device.traits).forEach((key) => {
      try {
        const traitName = _getShortTraitName(key);
        result.traits[traitName] = device.traits[key];
      } catch (ex) {
        const extra = device.traits[key];
        log.error(LOG_PREFIX, `Unable to set trait for '${key}'`, extra);
      }
    });
    const customName = result.traits?.info?.customName;
    if (customName) {
      result.customName = customName;
      delete result.traits.info.customName;
      // result.traits.info.customName = null;
    }
    if (diff(_deviceState[id], result)) {
      _deviceState[id] = result;
      _self.emit('device_changed', result);
    }
  }

  /**
   * Simplify and camel case the trait name.
   *
   * @param {String} traitName Trait name from API
   * @return {String}
   */
  function _getShortTraitName(traitName) {
    const startAt = traitName.lastIndexOf('.') + 1;
    const result = traitName.substring(startAt + 1);
    return traitName.substring(startAt, startAt + 1).toLowerCase() + result;
  }

  /**
   * Parse a room object and return something easier to consume
   *
   * @param {Object} room
   * @return {Object}
   */
  function _parseRoomInfo(room) {
    try {
      const id = room.parent.substring(room.parent.lastIndexOf('/') + 1);
      const name = room.displayName;
      return {id, name};
    } catch (ex) {
      log.error(LOG_PREFIX, 'Error parsing room info', ex);
      return {name: 'Unknown'};
    }
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
      log.debug(LOG_PREFIX, 'Getting new access token...');
      const resp = await fetch(url, {method: 'POST'});
      if (resp.ok) {
        const body = await resp.json();
        _accessToken = body.access_token;
        _accessTokenExpiresAt = now + (body.expires_in * 1000);
        log.verbose(LOG_PREFIX, 'Access token refreshed.');
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
      agent: _httpAgent,
    };
    if (body) {
      fetchOpts.body = JSON.stringify(body);
      fetchOpts.headers['Content-Type'] = 'application/json';
    }
    log.debug(LOG_PREFIX, `${msg}`, body);
    let resp;
    try {
      resp = await fetch(url, fetchOpts);
    } catch (ex) {
      if (retry) {
        log.verbose(LOG_PREFIX, `${msg} - Request error (will retry)`, ex);
        await honHelpers.sleep(2500);
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
      if (retry) {
        log.verbose(LOG_PREFIX, `${msg} - Response error (will retry)`, extra);
        // If we're over quota, add some extra time.
        const overQuotaDelay = resp.status === 429 ? 90 * 1000 : 0;
        await honHelpers.sleep(2500 + overQuotaDelay);
        return _sendRequest(requestPath, method, body, false);
      }
      log.error(LOG_PREFIX, `${msg} - Response error`, extra);
      throw new Error('Response Error');
    }

    let respBody;
    try {
      respBody = await resp.json();
    } catch (ex) {
      if (retry) {
        log.verbose(LOG_PREFIX, `${msg} - JSON error (will retry)`, ex);
        await honHelpers.sleep(2500);
        return _sendRequest(requestPath, method, body, false);
      }
      log.error(LOG_PREFIX, `${msg} - JSON error`, ex);
      throw new Error('JSON Conversion Error');
    }

    if (respBody.error) {
      if (retry) {
        log.verbose(LOG_PREFIX, `${msg} - Body error (will retry)`, respBody);
        await honHelpers.sleep(2500);
        return _sendRequest(requestPath, method, body, false);
      }
      log.warn(LOG_PREFIX, `${msg} - Body error`, respBody);
      throw new Error('Failed');
    }

    return respBody;
  }

  _init();
}

util.inherits(GDeviceAccess, EventEmitter);

module.exports = GDeviceAccess;
