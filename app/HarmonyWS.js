'use strict';

const util = require('util');
const request = require('request');
const log = require('./SystemLog2');
const diff = require('deep-diff').diff;
const WSClient = require('./WSClient');
const EventEmitter = require('events').EventEmitter;


const LOG_PREFIX = 'HARMONY_WS';

/**
 * Harmony Hub via Web Sockets API
 * @constructor
 *
 * @see https://github.com/home-assistant/pyharmony/blob/websockets/pyharmony/client.py
 * @see https://github.com/digitaldan/harmony-client/tree/master/src/main/java/com/digitaldan/harmony
 *
 * @fires Harmony#hub_info
 * @fires Harmony#activity_changed
 * @fires Harmony#config_changed
 * @fires Harmony#metadata_notify
 * @fires Harmony#state_notify
 * @param {String} ipAddress IP Address to the Hub
*/
function HarmonyWS(ipAddress) {
  const _self = this;
  const HUB_PORT = 8088;
  const CONFIG_REFRESH_INTERVAL = 18 * 60 * 1000;
  const PING_INTERVAL = 25 * 1000;
  const COMMAND_PREFIX = 'vnd.logitech.harmony/';
  const COMMAND_STRINGS = {
    BUTTON_PRESS: 'control.button?pressType',
    CONFIG: COMMAND_PREFIX + 'vnd.logitech.harmony.engine?config',
    GET_ACTIVITY: COMMAND_PREFIX +
        'vnd.logitech.harmony.engine?getCurrentActivity',
    HELP_DISCRETES: 'harmony.engine?helpdiscretes',
    HOLD_ACTION: COMMAND_PREFIX + 'vnd.logitech.harmony.engine?holdAction',
    METADATA: 'harmonyengine.metadata?notify',
    RUN_ACTIVITY: 'harmony.activityengine?runactivity',
    START_ACTIVITY_1: 'harmony.engine?startActivity',
    START_ACTIVITY_2: 'harmony.engine?startactivity',
    START_ACTIVITY_FINISHED: 'harmony.engine?startActivityFinished',
    STATE_DIGEST_NOTIFY: 'connect.stateDigest?notify',
    SYNC: 'setup.sync',
    PING: 'vnd.logitech.connect/vnd.logitech.ping',
  };
  const _ipAddress = ipAddress;
  let _wsClient;
  let _pingInterval;
  let _hubId;
  let _msgId = 1;
  let _config = {};
  let _activitiesById = {};
  let _activitiesByName = {};


  /**
   * Init
   */
  function _init() {
    log.init(LOG_PREFIX, 'Starting...', {ipAddress: _ipAddress});
    _getHubInfo().then((hubInfo) => {
      log.verbose(LOG_PREFIX, 'Hub info received', hubInfo);
      _hubId = hubInfo.activeRemoteId;
      _self.emit('hub_info', hubInfo);
      _connect();
    }).catch((err) => {
      log.exception(LOG_PREFIX, 'Init failed', err);
    });
  }

  /**
   * Start the activity by ID
   *
   * @param {Number} activityId
   * @return {Boolean}
   */
  this.setActivityById = function(activityId) {
    const msg = `setActivityById('${activityId}')`;
    if (!activityId) {
      log.error(LOG_PREFIX, `${msg} failed, missing 'activityId'`);
      return Promise.reject(new Error('activity_id_missing'));
    }
    const params = {
      async: true,
      timestamp: Date.now(),
      args: {
        rule: 'start',
      },
      activityId: activityId.toString(),
    };
    log.debug(LOG_PREFIX, msg, params);
    return _sendCommand(COMMAND_STRINGS.RUN_ACTIVITY, params);
  };

  /**
   * Start the named activity
   *
   * @param {String} activityName
   * @return {Boolean}
   */
  this.setActivityByName = function(activityName) {
    const msg = `setActivityByName('${activityName}')`;
    if (!activityName) {
      log.error(LOG_PREFIX, `${msg} failed, missing 'activityName'`);
      return Promise.reject(new Error('activity_name_missing'));
    }
    const activityId = _activitiesByName[activityName];
    if (!activityId) {
      log.error(LOG_PREFIX, `${msg} failed, activity not found.`);
      return Promise.reject(new Error('activity_not_found'));
    }
    return _self.setActivityById(activityId);
  };

  /**
   * Sends the specified key
   *
   * @param {String} cmd
   * @return {Boolean}
   */
  this.sendKey = function(cmd) {
    const msg = `sendKey({...})`;
    if (!cmd || typeof cmd !== 'string') {
      log.error(LOG_PREFIX, `${msg} failed, invalid command.`);
      return Promise.reject(new TypeError('invalid_command'));
    }
    const params = {
      status: 'press',
      timestamp: Date.now(),
      verb: 'render',
      action: cmd,
    };
    log.debug(LOG_PREFIX, msg, params);
    return _sendCommand(COMMAND_STRINGS.HOLD_ACTION, params);
  };

  /**
  * Syncs the hub to the web service
  *
  * @return {Boolean}
  */
  this.sync = function() {
    const msg = `sync()`;
    log.debug(LOG_PREFIX, msg);
    return _sendCommand(COMMAND_STRINGS.SYNC);
  };

  /**
   * Close the Harmony Hub connection and shut down
   */
  this.close = function() {
    log.log(LOG_PREFIX, 'close()');
    if (_wsClient) {
      try {
        _wsClient.shutdown();
      } catch (ex) {
        log.exception(LOG_PREFIX, 'Unable to close client.', ex);
      }
      _wsClient = null;
    }
  };

  /**
   * Get hub info
   *
   * @return {Promise} hubInfo
   */
  function _getHubInfo() {
    return new Promise((resolve, reject) => {
      const requestOptions = {
        uri: `http://${_ipAddress}:${HUB_PORT}`,
        method: 'POST',
        json: true,
        agent: false,
        headers: {
          'Origin': 'http://sl.dhg.myharmony.com',
        },
        body: {
          id: 1,
          cmd: 'setup.account?getProvisionInfo',
          params: {},
        },
      };
      request(requestOptions, (error, response, respBody) => {
        if (error) {
          log.error(LOG_PREFIX, `_getHubInfo() error`, error);
          reject(error);
          return;
        }
        if (!respBody || respBody.code !== '200' || !respBody.code) {
          log.error(LOG_PREFIX, `_getHubInfo() response error`, respBody);
          if (response.headers) {
            const headers = response.headers;
            log.error(LOG_PREFIX, `_getHubInfo() response headers`, headers);
          }
          reject(new Error('get_hub_info'));
          return;
        }
        resolve(respBody.data);
      });
    });
  }

  /**
   * Open WebSocket port & connect to the Harmony Hub
   */
  function _connect() {
    const wsQuery = `domain=svcs.myharmony.com&hubId=${_hubId}`;
    const wsURL = `ws://${_ipAddress}:${HUB_PORT}/?${wsQuery}`;
    _wsClient = new WSClient(wsURL, true, 'harmony');
    _wsClient.on('message', (msg) => {
      _wsMessageReceived(msg);
    });
    _wsClient.on('connect', () => {
      log.debug(LOG_PREFIX, `Connected to Harmony Hub.`);
      _getConfig();
      _getActivity();
      _startPing();
    });
    setInterval(_getConfig, CONFIG_REFRESH_INTERVAL);
  }

  /**
   * Starts the system ping.
   */
  function _startPing() {
    if (_pingInterval) {
      log.warn(LOG_PREFIX, 'Ping interval already started.');
      return;
    }
    _pingInterval = setInterval(() => {
      return _sendCommand(COMMAND_STRINGS.PING).catch((err) => {
        // Ignore this error, it's already been reported elsewhere.
      });
    }, PING_INTERVAL);
  }

  /**
   * Handle incoming web socket message
   *
   * @param {Object} msgJSON Incoming message
   */
  function _wsMessageReceived(msgJSON) {
    if (msgJSON.cmd === COMMAND_STRINGS.PING) {
      return;
    }
    if (msgJSON.cmd === COMMAND_STRINGS.CONFIG) {
      _configChanged(msgJSON.data);
      return;
    }
    if (msgJSON.cmd === COMMAND_STRINGS.RUN_ACTIVITY) {
      if (msgJSON.code !== 200) {
        log.error(LOG_PREFIX, 'Error starting activity', msgJSON);
      }
      return;
    }
    if (msgJSON.cmd === COMMAND_STRINGS.GET_ACTIVITY) {
      _activityChanged(msgJSON.data.result);
      return;
    }
    if (msgJSON.type === COMMAND_STRINGS.START_ACTIVITY_FINISHED) {
      _activityChanged(msgJSON.data.activityId);
      return;
    }
    if (msgJSON.type === COMMAND_STRINGS.STATE_DIGEST_NOTIFY) {
      log.verbose(LOG_PREFIX, `State Digest Notify`, msgJSON.data);
      _self.emit('state_notify', msgJSON.data);
      return;
    }
    if (msgJSON.type === COMMAND_STRINGS.METADATA) {
      log.verbose(LOG_PREFIX, `Metadata Notify`, msgJSON.data);
      _self.emit('metadata_notify', msgJSON.data);
      return;
    }
    // Message types we don't care about
    if (msgJSON.type === COMMAND_STRINGS.BUTTON_PRESS ||
        msgJSON.cmd === COMMAND_STRINGS.HELP_DISCRETES ||
        msgJSON.cmd === COMMAND_STRINGS.START_ACTIVITY_1 ||
        msgJSON.cmd === COMMAND_STRINGS.START_ACTIVITY_2) {
      return;
    }
    log.log(LOG_PREFIX, 'Unknown message received.', msgJSON);
  }


  /**
   * Send a message to the hub using the web socket
   *
   * @param {String} command Outgoing message to send.
   * @param {Object} params Optional parameters.
   * @return {boolean} True if message was sent.
   */
  function _sendCommand(command, params) {
    if (!_wsClient || _wsClient.connected === false) {
      log.error(LOG_PREFIX, 'Unable to send command, no WebSocket connection.');
      return Promise.reject(new Error('not_ready'));
    }
    const defaultParams = {
      verb: 'get',
      format: 'json',
    };
    const payload = {
      hubId: _hubId,
      timeout: 30,
      hbus: {
        cmd: command,
        id: _msgId++,
        params: params || defaultParams,
      },
    };
    log.verbose(LOG_PREFIX, '_sendCommand({...})', payload);
    return _wsClient.send(JSON.stringify(payload))
        .catch((err) => {
          log.exception(LOG_PREFIX, '_sendCommand({...}) failed.', err);
          throw err;
        });
  }


  /**
   * Handles activity change and fires activity_changed event
   *
   * @fires Harmony#activity_changed
   * @param {Number} activityId The Activity ID
  */
  function _activityChanged(activityId) {
    const activity = {
      id: activityId,
      label: _activitiesById[activityId],
    };
    /**
     * Fired when the activity has changed
     * @event Harmony#activity_changed
     * @type {Object}
     */
    log.debug(LOG_PREFIX, `activityChanged(...)`, activity);
    _self.emit('activity_changed', activity);
  }


  /**
   * Handles config change and fires config_changed event
   *
   * @fires Harmony#config_changed
   * @param {Object} config
  */
  function _configChanged(config) {
    if (!config.activity) {
      // Config doesn't have activities, it's prob not a config obj
      const msg = `configChanged failed, config object missing 'activity'.`;
      log.error(LOG_PREFIX, msg, config);
      return;
    }
    if (!diff(_config, config)) {
      // Config hasn't changed, we can skip.
      return;
    }
    _config = config;
    const activities = config.activity;
    const activitiesById = {};
    const activitiesByName = {};
    activities.forEach((activity) => {
      activitiesById[activity.id] = activity.label;
      activitiesByName[activity.label] = activity.id;
    });
    _activitiesById = activitiesById;
    _activitiesByName = activitiesByName;
    /**
     * Fired when the config has changed
     * @event Harmony#config_changed
     * @type {Object}
     */
    log.verbose(LOG_PREFIX, 'Config changed.', config);
    _self.emit('config_changed', config);
  }

  /**
   * Request an update to the config info
   *   Response will be sent as an event when the Hub returns the data
   *
   * @return {Boolean}
  */
  function _getConfig() {
    return _sendCommand(COMMAND_STRINGS.CONFIG);
  }

  /**
   * Request an update to the current activity
   *   Response will be sent as an event when the hub returns the data
   *
   * @return {Boolean}
  */
  function _getActivity() {
    return _sendCommand(COMMAND_STRINGS.GET_ACTIVITY);
  }

  _init();
}

util.inherits(HarmonyWS, EventEmitter);

module.exports = HarmonyWS;
