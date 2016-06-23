'use strict';

var log = require('./SystemLog');
var EventEmitter = require('events').EventEmitter;
var util = require('util');
var SonosDiscovery = require('./sonos-discovery/lib/sonos.js');

// Based on https://github.com/jishi/node-sonos-discovery

function Sonos() {
  var _self = this;
  var _sonos;
  var _favorites = {};

  var _logger = {
    stringify: function() {
      var result = '';
      Array.prototype.slice.call(arguments).forEach(function(arg) {
        if (typeof arg === 'string') {
          result += arg + ' ';
        } else {
          result += util.inspect(arg) + ' ';
        }
      });
      return result.trim();
    },
    info: function() {
      log.info('[SONOS*]' + this.stringify(arguments));
    },
    error: function() {
      log.error('[SONOS*] ' + this.stringify(arguments));
    },
    debug: function(arg) {
      log.debug('[SONOS*] ' + this.stringify(arguments));
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
        log.debug('[SONOS] getPlayer: ' + speaker.roomName);
        return speaker;
      }
      speaker = _sonos.getAnyPlayer();
      if (speaker) {
        log.debug('[SONOS] getPlayer: ' + speaker.roomName);
        return speaker;
      }
    }
    log.error('[SONOS] getPlayer failed, no speakers found.');
    return null;
  }

  function genericResponseHandler(apiName, error, response) {
    var msg = '[SONOS] genericResponseHandler - ' + apiName;
    if (response) {
      try {
        msg += ': ' + util.inspect(response);
      } catch (ex) {
        var exMsg = '[SONOS] Unable to stringify response: ' + response;
        log.exception(exMsg, ex);
        msg += ': ' + response;
      }
    }
    if (error) {
      log.error(msg + ' -- ' + error.toString());
    } else {
      log.debug(msg);
    }
  }


  /*****************************************************************************
   *
   * Public API
   *
   ****************************************************************************/

  this.applyPreset = function(preset) {
    if (_sonos) {
      _sonos.applyPreset(preset, function(error, response) {
        genericResponseHandler('applyPreset', error, response);
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
        speaker.play(function(error, response) {
          genericResponseHandler('play', error, response);
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
        speaker.pause(function(error, response) {
          genericResponseHandler('pause', error, response);
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
        speaker.nextTrack(function(error, response) {
          genericResponseHandler('nextTrack', error, response);
        });
        return true;
      }
      log.error('[SONOS] next failed, unable to find speaker.');
      return false;
    }
    log.error('[SONOS] next failed, Sonos unavilable.');
    return false;
  };

  this.previous = function(roomName) {
    if (_sonos) {
      var speaker = getPlayer(roomName);
      if (speaker) {
        speaker.previousTrack(function(error, response) {
          genericResponseHandler('previousTrack', error, response);
        });
        return true;
      }
      log.error('[SONOS] previous failed, unable to find speaker.');
      return false;
    }
    log.error('[SONOS] previous failed, Sonos unavilable.');
    return false;
  };

  this.volumeDown = function(roomName) {
    if (_sonos) {
      var speaker = getPlayer(roomName);
      if (speaker) {
        speaker.setVolume('-2', function(error, response) {
          genericResponseHandler('volumeDown', error, response);
        });
        return true;
      }
      log.error('[SONOS] volumeDown failed, unable to find speaker.');
      return false;
    }
    log.error('[SONOS] volumeDown failed, Sonos unavilable.');
    return false;
  };

  this.volumeUp = function(roomName) {
    if (_sonos) {
      var speaker = getPlayer(roomName);
      if (speaker) {
        speaker.setVolume('+2', function(error, response) {
          genericResponseHandler('volumeUp', error, response);
        });
        return true;
      }
      log.error('[SONOS] volumeUp failed, unable to find speaker.');
      return false;
    }
    log.error('[SONOS] volumeUp failed, Sonos unavilable.');
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
