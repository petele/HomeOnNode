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
      log.log('[SONOS] ' + arg);
    },
    error: function(arg) {
      log.error('[SONOS] ' + arg);
    },
    debug: function(arg) {
      log.debug('[SONOS] ' + arg);
    }
  };

  function init() {
    log.init('[SONOS] Init start.');
    process.on('SIGINT', handleSigInt);
    _sonos = new SonosDiscovery({log: _logger});
    _sonos.on('transport-state', transportStateChange);
    _sonos.on('favorites', favoritesChanged);
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

  function transportStateChange(transportState) {
    _self.emit('transport-state', transportState);
  }

  function favoritesChanged(favorites) {
    _favorites = favorites;
    _self.emit('favorites', favorites);
  }

  /*****************************************************************************
   *
   * Internal help functions
   *
   ****************************************************************************/

  function getPlayer(roomName) {
    if (_sonos) {
      var speaker = _sonos.getPlayer(roomName);
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


  /*****************************************************************************
   *
   * Public API
   *
   ****************************************************************************/

  this.applyPreset = function(preset) {
    if (_sonos) {
      _sonos.applyPreset(preset, function(err, response) {
        if (err) {
          log.error('[SONOS] applyPreset error: ' + err);
        }
        if (response) {
          log.debug('[SONOS] applyPreset: ' + response);
        }
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
        speaker.play(function(err, result) {
          if (err) {
            log.error('[SONOS] play failed: ' + err);
          }
          if (result) {
            log.debug('[SONOS] play: ' + result);
          }
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
        speaker.pause(function(err, result) {
          if (err) {
            log.error('[SONOS] pause failed: ' + err);
          }
          if (result) {
            log.debug('[SONOS] pause: ' + result);
          }
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
        speaker.next(function(err, result) {
          if (err) {
            log.error('[SONOS] next failed: ' + err);
          }
          if (result) {
            log.debug('[SONOS] next: ' + result);
          }
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
  }

  init();
}

util.inherits(Sonos, EventEmitter);

module.exports = Sonos;
