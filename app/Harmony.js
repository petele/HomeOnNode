'use strict';

const EventEmitter = require('events').EventEmitter;
const util = require('util');
const XMPP = require('node-xmpp-client');
const log = require('./SystemLog2');
const HarmonyHubDiscovery = require('harmonyhubjs-discover');

const LOG_PREFIX = 'HARMONY';

/**
 * Harmony Hub API
 *
 * @fires Harmony#activity_changed
 * @fires Harmony#config_changed
 *
 * @param {String} uuid Authentication UUID needed by the hub
*/
function Harmony(uuid) {
  const _uuid = uuid;
  const _self = this;
  const RECONNECT_DELAY = 30 * 1000;
  const KEEP_ALIVE_INTERVAL = 25 * 1000;
  const CONFIG_REFRESH_INTERVAL = 18 * 60 * 1000;
  const COMMAND_PREFIX = 'vnd.logitech.harmony/';
  const COMMAND_STRINGS = {
    CONFIG: COMMAND_PREFIX + 'vnd.logitech.harmony.engine?config',
    ACTIVITY: COMMAND_PREFIX + 'vnd.logitech.harmony.engine?getCurrentActivity',
    START_ACTIVITY_FINISHED: 'harmony.engine?startActivityFinished',
    STATE_DIGEST_NOTIFY: 'connect.stateDigest?notify',
    START_ACTIVITY: 'harmony.engine?startactivity',
    HOLD_ACTION: COMMAND_PREFIX + 'vnd.logitech.harmony.engine?holdAction',
  };
  let _client;
  let _discoveryClient;
  let _activitiesByName = {};
  let _activitiesById = {};
  let _shutdown = false;

  /**
   * Start the named activity
   *
   * @param {String} activityName
   * @return {Boolean}
  */
  this.setActivityByName = function(activityName) {
    const activityId = _activitiesByName[activityName];
    if (activityId) {
      return _setActivityById(activityId);
    } else {
      log.error(LOG_PREFIX, 'Unable to find activity named: ' + activityName);
      return false;
    }
  };

  /**
   * Close the Harmony Hub connection and shut down
  */
  this.close = function() {
    log.log(LOG_PREFIX, 'Shutting down.');
    _shutdown = true;
    if (_client) {
      try {
        _client.end();
      } catch (ex) {
        log.exception(LOG_PREFIX, 'Unable to close client.', ex);
      }
      _client = null;
    }
  };

  /**
   * Init
  */
  function _init() {
    _findHarmonyHubs();
    setInterval(_updateConfigRequest, CONFIG_REFRESH_INTERVAL);
    setInterval(_keepAlive, KEEP_ALIVE_INTERVAL);
  }

  /**
   * Connect to the hub
   *
   * @param {String} ip
  */
  function _connect(ip) {
    log.log(LOG_PREFIX, 'Connecting to Harmony using IP: ' + ip);
    try {
      let _connectionString = {
        jid: uuid + '@connect.logitech.com/gatorade.',
        password: uuid,
        domain: '@connect.logitech.com/gatorade.',
        host: ip,
      };
      _client = new XMPP.Client(_connectionString);
      _client.connection.socket.on('error', _handleSocketError);
      _client.on('error', _handleError);
      _client.on('online', _handleOnline);
      _client.on('stanza', _handleStanza);
      _client.on('offline', _handleOffline);
      _client.on('connect', _handleConnect);
      _client.on('reconnect', _handleReconnect);
      _client.on('disconnect', _handleDisconnect);
    } catch (ex) {
      log.exception(LOG_PREFIX, 'Unable to connect to Harmony Hub', ex);
      _resetConnection();
    }
  }

  /**
   * Reset the Harmony connection
  */
  function _resetConnection() {
    if (_shutdown === true) {
      return;
    }
    log.log(LOG_PREFIX, 'Resetting Harmony Hub connection...');
    if (_client) {
      try {
        _client.end();
      } catch (ex) {
        log.exception(LOG_PREFIX, 'Error closing connection during reset.');
      }
      _client = null;
    }
    setTimeout(() => {
      _connect();
    }, RECONNECT_DELAY);
  }

  /**
   * Find any Harmony Hubs on the local network
  */
  function _findHarmonyHubs() {
    if (_discoveryClient) {
      log.warn(LOG_PREFIX, 'Already searching for Harmony Hubs...');
      return;
    }
    log.init(LOG_PREFIX, 'Searching for Harmony Hub...');
    try {
      _discoveryClient = new HarmonyHubDiscovery(61991);
    } catch (ex) {
      log.exception(LOG_PREFIX, 'Unable to initialize HarmonyHubDiscovery', ex);
      _resetConnection();
      return;
    }
    _discoveryClient.on('online', function(hub) {
      log.debug(LOG_PREFIX, 'Hub found on IP address: ' + hub.ip);
      _stopDiscoveryClient();
      _connect(hub.ip);
    });
    _discoveryClient.start();
    setTimeout(() => {
      _stopDiscoveryClient();
      if (!_client) {
        log.error(LOG_PREFIX, 'Timeout exceeded, no Harmony Hubs found.');
        _resetConnection();
      }
    }, 10000);
  }

  /**
   * Stops the dicoverClient and clears it
  */
  function _stopDiscoveryClient() {
    if (_discoveryClient) {
      try {
        _discoveryClient.stop();
      } catch (ex) {
        log.exception(LOG_PREFIX, 'Unable to stop discoverClient', ex);
      }
      _discoveryClient = null;
    }
  }

  /**
   * Handle XMPP Socket Error
   *
   * @fires Harmony#socket_error
   * @param {Error} err Socket error
  */
  function _handleSocketError(err) {
    log.exception(LOG_PREFIX, 'Socket Error', err);
  }

  /**
   * Handle XMPP Error
   *
   * @fires Harmony#error
   * @param {Error} err Error
  */
  function _handleError(err) {
    log.exception(LOG_PREFIX, 'Error reported', err);
  }

  /**
   * Online event handler
   *
   * @param {Object} connection Connection string
  */
  function _handleOnline(connection) {
    log.log(LOG_PREFIX, 'Online.');
    log.debug(LOG_PREFIX, 'Connection string', connection);
    _updateConfigRequest();
    _updateActivityRequest();
    _keepAlive();
  }

  /**
   * Handle incoming XMPP stanza
   *
   * @param {Object} data XMPP stanza
  */
  function _handleStanza(data) {
    let result;
    if (data.children.length >= 1) {
      const child = data.children[0];
      if (child.attrs.mime === COMMAND_STRINGS.CONFIG) {
        result = child.children.join('');
        result = JSON.parse(result);
        _configChanged(result);
      } else if (child.attrs.mime === COMMAND_STRINGS.ACTIVITY) {
        result = child.children.join('');
        result = result.split('=');
        _activityChanged(result[1]);
      } else if (child.attrs.type === COMMAND_STRINGS.START_ACTIVITY_FINISHED) {
        result = child.children.join('');
        result = result.split(':');
        for (let i = 0; i < result.length; i++) {
          if (result[i].indexOf('activityId') === 0) {
            result = result[i].split('=');
            _activityChanged(result[1]);
            break;
          } // if
        } // for
      } else if (child.attrs.type === COMMAND_STRINGS.STATE_DIGEST_NOTIFY) {
        // log.debug(LOG_PREFIX, 'State digest notification.');
      } else {
        // log.debug(LOG_PREFIX, `Unhandled response. <${child.name} ... />`);
      } // End of IF statements
    } // There is at least one child
  } // End of function

  /**
   * Handles activity change and fires activity_changed event
   *
   * @fires Harmony#activity_changed
   * @param {Number} activityId The Activity ID
  */
  function _activityChanged(activityId) {
    log.log(LOG_PREFIX, 'activity changed');
    const activity = {
      id: activityId,
      label: _activitiesById[activityId],
    };
    _self.emit('activity_changed', activity);
  }

  /**
   * Handles config change and fires config_changed event
   *
   * @fires Harmony#config_changed
   * @param {Object} config
  */
  function _configChanged(config) {
    log.log(LOG_PREFIX, 'config changed');
    const activities = config.activity;
    let activitiesById = {};
    let activitiesByName = {};
    activities.forEach(function(activity) {
      activitiesById[activity.id] = activity.label;
      activitiesByName[activity.label] = activity.id;
    });
    _activitiesById = activitiesById;
    _activitiesByName = activitiesByName;
    _self.emit('config_changed', config);
  }

  /**
   * XMPP connection has gone offline, potentially reconnect
  */
  function _handleOffline() {
    log.debug(LOG_PREFIX, 'Offline.');
    _resetConnection();
  }

  /**
   * Log a connect event
   *
   * @param {Object} connection
  */
  function _handleConnect(connection) {
    log.log(LOG_PREFIX, 'Connected.');
  }

  /**
   * Log a reconnect event
  */
  function _handleReconnect() {
    log.log(LOG_PREFIX, 'Reconnected.');
  }

  /**
   * Log a disconnect event
  */
  function _handleDisconnect() {
    log.warn(LOG_PREFIX, 'Disconnected.');
  }

  /**
   * Keep Alive - pings the Harmony Hub every 15 seconds
  */
  function _keepAlive() {
    if (_isReady() === true) {
      const cmd = new XMPP.Stanza.Iq({'id': _uuid});
      _client.send(cmd);
    }
  }

  /**
   * Is Ready?
   *
   * @return {Boolean}
  */
  function _isReady() {
    if (_client) {
      return true;
    }
    log.error(LOG_PREFIX, 'HarmonyHub not ready.');
    return false;
  }

  /**
   * Request an update to the config info
   *   Response will be sent as an event when the Hub returns the data
   *
   * @fires Harmony#tbd
   * @return {Boolean}
  */
  function _updateConfigRequest() {
    if (_isReady() !== true) {
      return false;
    }
    log.debug(LOG_PREFIX, 'getConfig');
    let cmd = new XMPP.Stanza.Iq({id: _uuid, type: 'get'})
      .c('oa', {
        'xmlns': 'connect.logitech.com',
        'mime': COMMAND_STRINGS.CONFIG,
      });
    _client.send(cmd);
    return true;
  }

  /**
   * Request an update to the current activity
   *   Response will be sent as an event when the hub returns the data
   *
   * @fires Harmony#tbd
   * @return {Boolean}
  */
  function _updateActivityRequest() {
    if (_isReady() !== true) {
      return false;
    }
    log.debug(LOG_PREFIX, 'getActivity.');
    // might need to be client.stanza
    let cmd = new XMPP.Stanza.Iq({id: _uuid})
      .c('oa', {
        'xmlns': 'connect.logitech.com',
        'mime': COMMAND_STRINGS.ACTIVITY,
      });
    _client.send(cmd);
    return true;
  }

  /**
   * Starts the selected activity
   *
   * @param {Number} activityId
   * @return {Boolean}
  */
  function _setActivityById(activityId) {
    if (_isReady() !== true) {
      return false;
    }
    const activityName = _activitiesById[activityId];
    if (!activityName) {
      log.error(LOG_PREFIX, 'activityId[${activityId}] not found.');
      return false;
    }
    const msg = `setActivity to: ${activityName} (${activityId})`;
    log.log(LOG_PREFIX, msg);
    let cmdText = 'activityId=' + activityId.toString();
    cmdText += ':timestamp=' + Date.now();
    let cmd = new XMPP.Stanza.Iq({'id': _uuid, 'type': 'get'})
      .c('oa', {
        'xmlns': 'connect.logitech.com',
        'mime': COMMAND_STRINGS.START_ACTIVITY,
      }).t(cmdText);
    _client.send(cmd);
    return true;
  }

  // /**
  //  * Send a key command
  //  *
  //  * @param {Object} cmd
  //  * @return {Boolean}
  // */
  // function _sendHarmonyKey(cmd) {
  //   if (_isReady() !== true) {
  //     return false;
  //   }
  //   log.log(LOG_PREFIX, 'sendCommand: ' + cmd.command);
  //   cmd = JSON.stringify(cmd);
  //   cmd = cmd.replace(/:/g, '::');
  //   const cmdText = 'action=' + cmd + ':status=press';
  //   let cmdStanza = new XMPP.Stanza.Iq({iq: _uuid, type: 'get'})
  //     .c('oa', {
  //       xmlns: 'connect.logitech.com',
  //       mime: COMMAND_STRINGS.HOLD_ACTION,
  //     }).t(cmdText);
  //   _client.send(cmdStanza);
  //   return true;
  // }

  _init();
}

util.inherits(Harmony, EventEmitter);

module.exports = Harmony;
