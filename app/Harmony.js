'use strict';

var EventEmitter = require('events').EventEmitter;
var util = require('util');
var XMPP = require('node-xmpp');
var log = require('./SystemLog');
var HarmonyHubDiscovery = require('harmonyhubjs-discover');

function Harmony(uuid, ip) {
  var _ip = ip;
  var _uuid = uuid;
  var client;
  var _self = this;
  this.currentActivity = -100;
  var reconnect = true;
  var _activitiesByName = {};
  var _activitiesById = {};
  var _isSearching = false;

  function connect() {
    if (_ip) {
      log.init('[HARMONY]');
      try {
        log.debug('[HARMONY] Starting connection on IP: ' + _ip);
        var _connectionString = {
          jid: _uuid + '@connect.logitech.com/gatorade.',
          password: _uuid,
          host: _ip,
          domain: '@connect.logitech.com/gatorade.'
        };
        client = new XMPP.Client(_connectionString);
        client.on('error', handleError);
        client.on('online', handleOnline);
        client.on('stanza', handleStanza);
        client.on('offline', handleOffline);
        client.on('connect', handleConnect);
        client.on('reconnect', handleReconnect);
        client.on('disconnect', handleDisconnect);
      } catch (ex) {
        log.exception('[HARMONY] Unable to connect to Harmony Hub', ex);
        _self.emit('error', ex);
      }
    } else {
      log.debug('[HARMONY] No Hub IP set, starting search.');
      findHarmonyHubs();
    }
  }

  function findHarmonyHubs() {
    log.log('[HARMONY] Searching for Harmony Hub...');
    var discover = new HarmonyHubDiscovery(61991);
    discover.on('online', function(hub) {
      _isSearching = false;
      log.log('[HARMONY] Hub found on IP address: ' + hub.ip);
      _ip = hub.ip;
      discover.stop();
      connect();
    });
    discover.start();
    _isSearching = true;
    setTimeout(function() {
      if (_isSearching === true) {
        discover.stop();
        _isSearching = false;
        log.error('[HARMONY] No Harmony Hub found.');
        _self.emit('error');
        discover = null;
      }
    }, 10000);
  }

  function handleError(err) {
    log.exception('[HARMONY] Error reported', err);
    _self.emit('error', err);
  }

  function handleOnline(connection) {
    log.log('[HARMONY] Online. ' + JSON.stringify(connection));
    _self.getConfig();
    _self.getActivity();
    keepAlive();
  }

  function handleStanza(data) {
    var result;
    if (data.children.length >= 1) {
      var child = data.children[0];
      if (child.attrs.mime === 'vnd.logitech.harmony/vnd.logitech.harmony.engine?config') {
        result = child.children.join('');
        result = JSON.parse(result);
        handleConfig(result);
        log.log('[HARMONY] Ready.');
        _self.emit('ready', result);
      } else if (child.attrs.mime === 'vnd.logitech.harmony/vnd.logitech.harmony.engine?getCurrentActivity') {
        result = child.children.join('');
        result = result.split('=');
        announceActivity(result[1]);
        _self.currentActivity = result[1];
      } else if (child.attrs.type === 'harmony.engine?startActivityFinished') {
        result = child.children.join('');
        result = result.split(':');
        for (var i = 0; i < result.length; i++) {
          if (result[i].indexOf('activityId') === 0) {
            result = result[i].split('=');
            announceActivity(result[1]);
            _self.currentActivity = result[1];
            break;
          } // if
        } // fpr
      } else if (child.attrs.type === 'connect.stateDigest?notify') {
        log.debug('[HARMONY] State digest notification.');
      } else {
        log.debug('[HARMONY] Unhandled response. <' + child.name + ' ... />');
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
    log.debug('[HARMONY] Offline.');
    if (reconnect) {
      connect();
    }
  }

  function handleConnect(connection) {
    log.debug('[HARMONY] Connected.');
  }

  function handleReconnect() {
    log.debug('[HARMONY] Reconnected.');
  }

  function handleDisconnect() {
    log.debug('[HARMONY] Disconnected.');
  }

  function keepAlive() {
    if (client !== undefined) {
      var cmd = new XMPP.Element('iq', {'id': _uuid});
      client.send(cmd);
    } else {

    }
    setTimeout(function() {
      if (reconnect) {
        keepAlive();
      }
    }, 15 * 1000);
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

  this.getConfig = function() {
    if (client === undefined) {
      _self.emit('error', 'Client not connected.');
      return {'error': 'Client not connected'};
    } else {
      log.debug('[HARMONY] getConfig');
      var cmd = new XMPP.Element('iq', {'id': _uuid})
        .c('oa', {
          'xmlns': 'connect.logitech.com',
          'mime': 'vnd.logitech.harmony/vnd.logitech.harmony.engine?config'
        });
      client.send(cmd);
      return {'action': 'getConfig'};
    }
  };

  this.getActivity = function(callback) {
    if (client === undefined) {
      _self.emit('error', 'Client not connected.');
      return {'error': 'Client not connected'};
    } else {
      log.debug('[HARMONY] getActivity.');
      var cmd = new XMPP.Element('iq', {'id': _uuid})
        .c('oa', {
          'xmlns': 'connect.logitech.com',
          'mime': 'vnd.logitech.harmony/vnd.logitech.harmony.engine?getCurrentActivity'
        });
      client.send(cmd);
      return {'action': 'getActivity'};
    }
  };

  this.setActivityByName = function(activityName) {
    var activityId = _activitiesByName[activityName];
    if (activityId) {
      return _self.setActivityById(activityId);
    } else {
      log.error('[HARMONY] Unable to find activity named: ' + activityName);
      return {'error': 'Activity name not found.'};
    }
  };

  this.setActivityById = function(activityID) {
    if (client === undefined) {
      _self.emit('error', 'Client not connected.');
      return {'error': 'Client not connected'};
    } else {
      log.log('[HARMONY] setActivity to: ' + activityID);
      var cmdText = 'activityId=' + activityID.toString() + ':timestamp=0';
      var cmd = new XMPP.Element('iq', {'id': _uuid, 'type': 'get'})
        .c('oa', {
          'xmlns': 'connect.logitech.com',
          'mime': 'harmony.engine?startactivity'
        }).t(cmdText);
      client.send(cmd);
      return {'action': 'setActivity', 'activityID': activityID};
    }
  };

  this.close = function() {
    reconnect = false;
    if (client) {
      log.log('[HARMONY] Closing.');
      client.end();
      client = null;
    }
    return {'action': 'close'};
  };

  connect();
}

util.inherits(Harmony, EventEmitter);

module.exports = Harmony;
