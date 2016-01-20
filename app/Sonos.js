'use strict';

var log = require('./SystemLog');
var EventEmitter = require('events').EventEmitter;
var util = require('util');
var SonosDiscovery = require('./sonos-discovery/lib/sonos.js');

function Sonos() {
  var _self = this;
  var _sonos;
  var _favorites = {};

  var _logger = {
    info: function(arg) {
      var args  = Array.prototype.slice.call(arguments);
      log.debug('[SONOS*] ' + args.join(' '));
    },
    error: function(arg) {
      var args  = Array.prototype.slice.call(arguments);
      log.error('[SONOS*] ' + args.join(' '));
    },
    debug: function(arg) {
      var args  = Array.prototype.slice.call(arguments);
      log.debug('[SONOS*] ' + args.join(' '));
    }
  };

  function init() {
    log.init('[SONOS] Init start.');
    process.on('SIGINT', handleSigInt);
    _sonos = new SonosDiscovery({log: _logger});
    _sonos.on('transport-state', transportStateChanged);
    _sonos.on('favorites', favoritesChanged);
    _sonos.on('topology-change', topologyChanged);
    log.init('[SONOS] Init complete.');
  }

  /*****************************************************************************
   *
   * Base connect/disconnect functions
   *
   ****************************************************************************/

  this.shutdown = function() {
    log.log('[SONOS] Shutting down...');
    // TODO
    return true;
  };


  /*****************************************************************************
   *
   * Event handlers
   *
   ****************************************************************************/

  function handleSigInt() {
    log.log('[SONOS] SIGINT received.');
    _self.shutdown();
  }

  function transportStateChanged(transportState) {
    _self.emit('transport-state', transportState);
  }

  function favoritesChanged(favorites) {
    _favorites = favorites;
    _self.emit('favorites', favorites);
  }

  function topologyChanged(zones) {
    _self.emit('topology-changed', zones);
  }

  /*****************************************************************************
   *
   * Internal help functions
   *
   ****************************************************************************/

  function getPlayer(roomName) {
    if (_sonos) {
      var speaker;
      if (roomName) {
        speaker = _sonos.getPlayer(roomName);
      }
      if (speaker) {
        return speaker;
      }
      speaker = _sonos.getAnyPlayer();
      if (speaker) {
        return speaker;
      }
    }
    return null;
  }

  function genericResponseHandler(apiName, success, response) {
    var msg = '[SONOS] ' + apiName;
    if (response) {
      msg += ': ' + response;
    }
    if (success) {
      log.debug(msg);
    } else {
      log.error(msg);
    }
  }


  /*****************************************************************************
   *
   * Public API
   *
   ****************************************************************************/

  this.applyPreset = function(preset) {
    if (_sonos) {
      _sonos.applyPreset(preset, function(success, response) {
        genericResponseHandler('applyPreset', success, response);
      });
      return true;
    }
    log.error('[SONOS] applyPreset failed, Sonos unavilable.');
    return false;
  };

  this.play = function(roomName) {
    if (_sonos) {
      var speaker = getPlayer(roomName);
      if (speaker) {
        speaker.play(function(success, response) {
          genericResponseHandler('play', success, response);
        });
        return true;
      }
      log.error('[SONOS] play failed, unable to find speaker.');
      return false;
    }
    log.error('[SONOS] play failed, Sonos unavilable.');
    return false;
  };

  this.pause = function(roomName) {
    if (_sonos) {
      var speaker = getPlayer(roomName);
      if (speaker) {
        speaker.pause(function(success, response) {
          genericResponseHandler('pause', success, response);
        });
        return true;
      }
      log.error('[SONOS] pause failed, unable to find speaker.');
      return false;
    }
    log.error('[SONOS] pause failed, Sonos unavilable.');
    return false;
  };

  this.next = function(roomName) {
    if (_sonos) {
      var speaker = getPlayer(roomName);
      if (speaker) {
        speaker.nextTrack(function(success, response) {
          genericResponseHandler('nextTrack', success, response);
        });
        return true;
      }
      log.error('[SONOS] next failed, unable to find speaker.');
      return false;
    }
    log.error('[SONOS] next failed, Sonos unavilable.');
    return false;
  };

  this.getZones = function() {
    if (_sonos) {
      return _sonos.getZones();
    }
    log.error('[SONOS] getZones failed, Sonos unavilable.');
    return null;
  };

  this.getFavorites = function() {
    return _favorites;
  };

  init();
}

util.inherits(Sonos, EventEmitter);

module.exports = Sonos;
