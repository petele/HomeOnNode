'use strict';

/* node14_ready */

const util = require('util');
const fetch = require('node-fetch');
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
  const CONFIG_REFRESH_INTERVAL = 16 * 60 * 1000;
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
  const GET_HUB_PROV_INFO = {
    id: 1,
    cmd: 'setup.account?getProvisionInfo',
    params: {},
  };
  const _ipAddress = ipAddress;
  let _wsClient;
  let _pingInterval;
  let _hubId;
  let _msgId = 1;
  let _config = {};
  let _activitiesById = {};
  let _activityIdByName = {};
  let _currentActivityId = null;

  let _connectionStarted = false;


  this.connect = async function(retry) {
    if (_wsClient) {
      return true;
    }
    if (_connectionStarted) {
      log.warn(LOG_PREFIX, 'Connection attempt already in progress...');
      return false;
    }
    _connectionStarted = true;
    log.init(LOG_PREFIX, 'Connecting...');

    try {
      const hubInfo = await _getHubInfo();
      log.verbose(LOG_PREFIX, 'Hub info received', hubInfo);
      _hubId = hubInfo.activeRemoteId;
      _self.emit('hub_info', hubInfo);
    } catch (ex) {
      if (retry) {
        _retryInitialConnection(retry);
      } else {
        _connectionStarted = false;
      }
      return false;
    }

    return new Promise((resolve, reject) => {
      const wsQuery = `domain=svcs.myharmony.com&hubId=${_hubId}`;
      const wsURL = `ws://${_ipAddress}:${HUB_PORT}/?${wsQuery}`;
      _wsClient = new WSClient(wsURL, true, 'harmony');
      _wsClient.on('message', (msg) => {
        _wsMessageReceived(msg);
      });
      _wsClient.on('connect', () => {
        log.debug(LOG_PREFIX, `Connected.`);
        _getConfig();
        _getActivity();
        _self.emit('ready');
        resolve(true);
        setInterval(_getConfig, CONFIG_REFRESH_INTERVAL);
      });
    });
  };

  // /**
  //  * Init
  //  */
  // async function _init() {
  //   log.init(LOG_PREFIX, 'Starting...', {ipAddress: _ipAddress});
  //   try {
  //     const hubInfo = await _getHubInfo();
  //     log.verbose(LOG_PREFIX, 'Hub info received', hubInfo);
  //     _hubId = hubInfo.activeRemoteId;
  //     _self.emit('hub_info', hubInfo);
  //     _connect();
  //   } catch (ex) {
  //     log.exception(LOG_PREFIX, 'Init failed', ex);
  //   }
  // }


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
    if (_isAlreadyOnActivity(activityId)) {
      log.verbose(LOG_PREFIX, `${msg} - skipped, already on activity.`);
      return Promise.resolve({ok: true, alreadySet: true});
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
    const activityId = _activityIdByName[activityName];
    if (!activityId) {
      log.error(LOG_PREFIX, `${msg} failed, activity not found.`);
      return Promise.reject(new Error('activity_not_found'));
    }
    log.debug(LOG_PREFIX, msg);
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
    if (_pingInterval) {
      clearInterval(_pingInterval);
      _pingInterval = null;
    }
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
  async function _getHubInfo() {
    const url = `http://${_ipAddress}:${HUB_PORT}`;

    const fetchOpts = {
      method: 'POST',
      body: JSON.stringify(GET_HUB_PROV_INFO),
      headers: {
        'Content-Type': 'application/json',
        'Origin': 'http://sl.dhg.myharmony.com',
      },
    };
    let resp;
    let respBody;
    try {
      resp = await fetch(url, fetchOpts);
      if (!resp.ok) {
        log.error(LOG_PREFIX, `_getHubInfo() response error`, resp);
        return;
      }
      respBody = await resp.json();
    } catch (ex) {
      log.exception(LOG_PREFIX, 'Server error.', ex);
      return;
    }
    return respBody.data;
  }

  /**
   * Handle incoming web socket message
   *
   * @param {Object} msgJSON Incoming message
   */
  function _wsMessageReceived(msgJSON) {
    const msg = `wsMessageReceived:`;
    if (msgJSON.cmd === COMMAND_STRINGS.PING) {
      if (msgJSON.code !== 200) {
        log.error(LOG_PREFIX, `${msg} Invalid ping response.`, msgJSON);
      }
      return;
    }
    if (msgJSON.cmd === COMMAND_STRINGS.CONFIG) {
      _configChanged(msgJSON.data);
      return;
    }
    if (msgJSON.cmd === COMMAND_STRINGS.RUN_ACTIVITY) {
      log.verbose(LOG_PREFIX, `${msg} RUN_ACTIVITY`, msgJSON);
      if (msgJSON.code !== 200) {
        log.error(LOG_PREFIX, `${msg} RUN_ACTIVITY failed.`, msgJSON);
      }
      return;
    }
    if (msgJSON.cmd === COMMAND_STRINGS.GET_ACTIVITY) {
      log.verbose(LOG_PREFIX, `${msg} GET_ACTIVITY`, msgJSON);
      _activityChanged(msgJSON.data.result);
      return;
    }
    if (msgJSON.type === COMMAND_STRINGS.START_ACTIVITY_FINISHED) {
      log.verbose(LOG_PREFIX, `${msg} START_ACTIVITY_FINISHED`, msgJSON);
      _activityChanged(msgJSON.data.activityId);
      return;
    }
    if (msgJSON.type === COMMAND_STRINGS.STATE_DIGEST_NOTIFY) {
      log.verbose(LOG_PREFIX, `${msg} STATE_DIGEST_NOTIFY`, msgJSON);
      _stateChanged(msgJSON.data);
      return;
    }
    if (msgJSON.type === COMMAND_STRINGS.METADATA) {
      log.verbose(LOG_PREFIX, `${msg} METADATA`, msgJSON);
      _self.emit('metadata_notify', msgJSON.data);
      return;
    }
    if (msgJSON.cmd === COMMAND_STRINGS.START_ACTIVITY_1) {
      log.verbose(LOG_PREFIX, `${msg} START_ACTIVITY_1`, msgJSON);
      return;
    }
    if (msgJSON.type === COMMAND_STRINGS.START_ACTIVITY_2) {
      log.verbose(LOG_PREFIX, `${msg} START_ACTIVITY_2`, msgJSON);
      return;
    }
    // Message types we don't care about
    if (msgJSON.type === COMMAND_STRINGS.BUTTON_PRESS ||
        msgJSON.cmd === COMMAND_STRINGS.HELP_DISCRETES) {
      return;
    }
    log.warn(LOG_PREFIX, 'Unknown message received.', msgJSON);
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
    // log.verbose(LOG_PREFIX, '_sendCommand({...})', payload);
    log.verbose(LOG_PREFIX, `_sendCommand({cmd: ${command}, ...})`);
    return _wsClient.send(JSON.stringify(payload))
        .catch((err) => {
          log.exception(LOG_PREFIX, '_sendCommand({...}) failed.', err);
          throw err;
        });
  }


  /**
   * Handles state change and fires state_notify event
   *
   * @fires Harmony#state_notify
   * @param {Object} state State object from Harmony Hub
   */
  function _stateChanged(state) {
    _saveActivityId(state?.activityId);
    _self.emit('state_notify', state);
    return;
  }

  /**
   * Checks if the current activityId is the same as provided.
   *
   * @param {Number} activityId
   * @return {Boolean} true if the same.
   */
  function _isAlreadyOnActivity(activityId) {
    return parseInt(_currentActivityId) === parseInt(activityId);
  }

  /**
   * Updates the saved activity ID
   *
   * @fires Harmony#activity_id_changed
   * @param {Number} activityId New activity ID
   */
  function _saveActivityId(activityId) {
    if (!activityId) {
      return;
    }
    log.verbose(LOG_PREFIX, `activityIdChanged(${activityId})`);
    _currentActivityId = parseInt(activityId);
    _self.emit('activity_id_changed', _currentActivityId);
  }

  /**
   * Handles activity change and fires activity_changed event
   *
   * @fires Harmony#activity_changed
   * @param {Number} activityId The Activity ID
  */
  function _activityChanged(activityId) {
    const msg = `activityChanged(${activityId})`;
    const activity = _activitiesById[activityId];
    if (!activity) {
      log.error(LOG_PREFIX, `${msg} - failed, 'activityId' not found.`);
      return;
    }
    _saveActivityId(activityId);
    log.debug(LOG_PREFIX, msg, activity);
    _self.emit('activity_changed', activity);
  }


  /**
   * Handles config change and fires config_changed event
   *
   * @fires Harmony#config_changed
   * @param {Object} config
  */
  function _configChanged(config) {
    if (!config || !config.activity) {
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
    const activityIdByName = {};
    activities.forEach((activity) => {
      activitiesById[activity.id] = activity;
      activityIdByName[activity.label] = activity.id;
    });
    _activitiesById = activitiesById;
    _activityIdByName = activityIdByName;
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
}

util.inherits(HarmonyWS, EventEmitter);

module.exports = HarmonyWS;
