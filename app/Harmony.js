'use strict';

var EventEmitter = require('events').EventEmitter;
var util = require('util');
var XMPP = require('node-xmpp-client');
var log = require('./SystemLog2');
var HarmonyHubDiscovery = require('harmonyhubjs-discover');

var LOG_PREFIX = 'HARMONY';

function Harmony(uuid, ip) {
  var _ip = ip;
  var _uuid = uuid;
  var client;
  var _self = this;
  var reconnect = true;
  var _activitiesByName = {};
  var _activitiesById = {};
  var _isSearching = false;
  this.currentActivity = -100;

  var COMMAND_PREFIX = 'vnd.logitech.harmony/';
  var COMMAND_STRINGS = {
    CONFIG: COMMAND_PREFIX + 'vnd.logitech.harmony.engine?config',
    ACTIVITY: COMMAND_PREFIX + 'vnd.logitech.harmony.engine?getCurrentActivity',
    START_ACTIVITY_FINISHED: 'harmony.engine?startActivityFinished',
    STATE_DIGEST_NOTIFY: 'connect.stateDigest?notify',
    START_ACTIVITY: 'harmony.engine?startactivity',
    HOLD_ACTION: COMMAND_PREFIX + 'vnd.logitech.harmony.engine?holdAction'
  };

  function connect() {
    if (_ip) {
      log.init(LOG_PREFIX, 'Using IP: ' + _ip);
      try {
        log.debug(LOG_PREFIX, 'Starting connection on IP: ' + _ip);
        var _connectionString = {
          jid: _uuid + '@connect.logitech.com/gatorade.',
          password: _uuid,
          host: _ip,
          domain: '@connect.logitech.com/gatorade.'
        };
        client = new XMPP.Client(_connectionString);
        client.connection.socket.on('error', handleSocketError);
        client.on('error', handleError);
        client.on('online', handleOnline);
        client.on('stanza', handleStanza);
        client.on('offline', handleOffline);
        client.on('connect', handleConnect);
        client.on('reconnect', handleReconnect);
        client.on('disconnect', handleDisconnect);
      } catch (ex) {
        log.exception(LOG_PREFIX, 'Unable to connect to Harmony Hub', ex);
        _self.emit('connection_failed', ex);
      }
    } else {
      log.debug(LOG_PREFIX, 'No Hub IP set, starting search.');
      findHarmonyHubs();
    }
  }

  function findHarmonyHubs() {
    log.init(LOG_PREFIX, 'Searching for Harmony Hub...');
    var discover;
    try {
      discover = new HarmonyHubDiscovery(61991);
    } catch (ex) {
      log.exception(LOG_PREFIX, 'Unable to initialize HarmonyHubDiscovery', ex);
      _self.emit('hub_search_failed', ex);
    }

    if (discover) {
      discover.on('online', function(hub) {
        _isSearching = false;
        log.debug(LOG_PREFIX, 'Hub found on IP address: ' + hub.ip);
        _ip = hub.ip;
        discover.stop();
        discover = null;
        connect();
      });
      discover.start();
      _isSearching = true;
      setTimeout(function() {
        if (_isSearching === true) {
          discover.stop();
          _isSearching = false;
          log.error(LOG_PREFIX, 'Timeout exceeded, no Harmony Hubs found.');
          _self.emit('no_hubs_found');
          discover = null;
        }
      }, 10000);
    }
  }

  function handleSocketError(err) {
    log.exception(LOG_PREFIX, 'Socket Error', err);
    _self.emit('socket_error', err);
  }

  function handleError(err) {
    log.exception(LOG_PREFIX, 'Error reported', err);
    _self.emit('error', err);
  }

  function handleOnline(connection) {
    log.log(LOG_PREFIX, 'Online.');
    log.debug(LOG_PREFIX, 'Connection string', connection);
    _self.getConfig();
    _self.getActivity();
    keepAlive();
  }

  function handleStanza(data) {
    var result;
    if (data.children.length >= 1) {
      var child = data.children[0];
      if (child.attrs.mime === COMMAND_STRINGS.CONFIG) {
        result = child.children.join('');
        result = JSON.parse(result);
        handleConfig(result);
        _self.emit('ready', result);
      } else if (child.attrs.mime === COMMAND_STRINGS.ACTIVITY) {
        result = child.children.join('');
        result = result.split('=');
        announceActivity(result[1]);
        _self.currentActivity = result[1];
      } else if (child.attrs.type === COMMAND_STRINGS.START_ACTIVITY_FINISHED) {
        result = child.children.join('');
        result = result.split(':');
        for (var i = 0; i < result.length; i++) {
          if (result[i].indexOf('activityId') === 0) {
            result = result[i].split('=');
            announceActivity(result[1]);
            _self.currentActivity = result[1];
            break;
          } // if
        } // for
      } else if (child.attrs.type === COMMAND_STRINGS.STATE_DIGEST_NOTIFY) {
        // log.debug(LOG_PREFIX, 'State digest notification.');
      } else {
        // log.debug(LOG_PREFIX, 'Unhandled response. <' + child.name + ' ... />');
      } // End of IF statements
    } // There is at least one child
  } // End of function

  function announceActivity(activityId) {
    var activity = {
      id: activityId,
      label: _activitiesById[activityId]
    };
    _self.emit('activity', activity);
  }

  function handleOffline() {
    log.debug(LOG_PREFIX, 'Offline.');
    if (reconnect) {
      connect();
    }
  }

  function handleConnect(connection) {
    log.log(LOG_PREFIX, 'Connected.');
  }

  function handleReconnect() {
    log.log(LOG_PREFIX, 'Reconnected.');
  }

  function handleDisconnect() {
    log.warn(LOG_PREFIX, 'Disconnected.');
  }

  function keepAlive() {
    if (checkIfReady()) {
      var cmd = new XMPP.Stanza.Iq({'id': _uuid});
      client.send(cmd);
      setTimeout(function() {
        if (reconnect) {
          keepAlive();
        }
      }, 15 * 1000);
    }
  }

  function handleConfig(harmonyConfig) {
    var activities = harmonyConfig.activity;
    _activitiesById = {};
    _activitiesByName = {};
    activities.forEach(function(activity) {
      _activitiesById[activity.id] = activity.label;
      _activitiesByName[activity.label] = activity.id;
    });
  }

  function checkIfReady() {
    if (client) {
      return true;
    }
    _self.emit('no_client');
    return false;
  }

  this.getConfig = function() {
    if (checkIfReady() === false) {
      return {'error': 'Client not connected'};
    } else {
      log.debug(LOG_PREFIX, 'getConfig');
      var cmd = new XMPP.Stanza.Iq({'id': _uuid, type: 'get'})
        .c('oa', {
          'xmlns': 'connect.logitech.com',
          'mime': COMMAND_STRINGS.CONFIG
        });
      client.send(cmd);
      return {'action': 'getConfig'};
    }
  };

  this.getActivity = function(callback) {
    if (checkIfReady() === false) {
      return {'error': 'Client not connected'};
    } else {
      log.debug(LOG_PREFIX, 'getActivity.');
      // might need to be client.stanza
      var cmd = new XMPP.Stanza.Iq({'id': _uuid})
        .c('oa', {
          'xmlns': 'connect.logitech.com',
          'mime': COMMAND_STRINGS.ACTIVITY
        });
      client.send(cmd);
      return {'action': 'getActivity'};
    }
  };

  this.setActivityByName = function(activityName) {
    var activityId = _activitiesByName[activityName];
    if (activityId) {
      return _self.setActivityById(activityId, activityName);
    } else {
      log.error(LOG_PREFIX, 'Unable to find activity named: ' + activityName);
      return {'error': 'Activity name not found.'};
    }
  };

  this.setActivityById = function(activityID, activityName) {
    if (checkIfReady() === false) {
      return {'error': 'Client not connected'};
    } else {
      var msg = 'setActivity to: ' + activityID;
      if (activityName) {
        msg += ' (' + activityName + ')';
      }
      log.log(LOG_PREFIX, msg);
      var cmdText = 'activityId=' + activityID.toString();
      cmdText += ':timestamp=' + Date.now();
      var cmd = new XMPP.Stanza.Iq({'id': _uuid, 'type': 'get'})
        .c('oa', {
          'xmlns': 'connect.logitech.com',
          'mime': COMMAND_STRINGS.START_ACTIVITY
        }).t(cmdText);
      client.send(cmd);
      return {'action': 'setActivity', 'activityID': activityID};
    }
  };

  this.sendCommand = function(cmd) {
    if (checkIfReady() === false) {
      return {'error': 'Client not connected'};
    } else {
      log.log(LOG_PREFIX, 'sendCommand: ' + cmd.command);
      cmd = JSON.stringify(cmd);
      cmd = cmd.replace(/:/g, '::');
      var cmdText = 'action=' + cmd + ':status=press';
      var cmdStanza = new XMPP.Stanza.Iq({iq: _uuid, type: 'get'})
        .c('oa', {
          xmlns: 'connect.logitech.com',
          mime: COMMAND_STRINGS.HOLD_ACTION
        }).t(cmdText);
      client.send(cmdStanza);
      return {'action': 'sendCommand', 'command': cmd};
    }
  };

  this.close = function() {
    reconnect = false;
    if (client) {
      log.log(LOG_PREFIX, 'Closing.');
      try {
        client.end();
      } catch (ex) {
        log.exception(LOG_PREFIX, 'Unable to close client.', ex);
      }
      client = null;
    }
    return {'action': 'close'};
  };

  connect();
}

util.inherits(Harmony, EventEmitter);

module.exports = Harmony;
