'use strict';

var log = require('./SystemLog');
var EventEmitter = require('events').EventEmitter;
var util = require('util');
var SonosDiscovery = require('./sonos-discovery/lib/sonos.js');

// Based on https://github.com/jishi/node-sonos-discovery

// TODO - when it all works, update Home:
//   Remove roomName definition
//   Use stopAll when away

function Sonos() {
  var _self = this;
  var _sonos;

  var _logger = {
    stringify: function(args) {
      var result = '';
      Array.prototype.slice.call(args).forEach(function(arg) {
        if (typeof arg === 'string') {
          result += arg + ' ';
        } else {
          result += util.inspect(arg, {depth: 3}) + ' ';
        }
      });
      return result.trim();
    },
    info: function() {
      log.log('[SONOS*] ' + this.stringify(arguments));
    },
    error: function() {
      log.error('[SONOS*] ' + this.stringify(arguments));
    },
    debug: function() {
      log.debug('[SONOS*] ' + this.stringify(arguments));
    }
  };

  function init() {
    log.init('[SONOS] Init start.');
    _sonos = new SonosDiscovery({log: _logger});
    _sonos.on('transport-state', transportStateChanged);
    _sonos.on('favorites-change', favoritesChanged);
    _sonos.on('topology-change', topologyChanged);
    addGenericEventListener('topology');
    addGenericEventListener('favorites');
    addGenericEventListener('last-change');
    addGenericEventListener('group-mute');
    addGenericEventListener('queue-change');
    addGenericEventListener('found');
    addGenericEventListener('mute-change');
    addGenericEventListener('volume-change');
    addGenericEventListener('listening');
    addGenericEventListener('group-volume');
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

  function addGenericEventListener(eventName) {
    _sonos.on(eventName, function() {
      var msg = '[SONOS] genericEvent(' + eventName + ') ';
      Array.prototype.slice.call(arguments).forEach(function(arg) {
        msg += arg + ' ';
      });
      log.debug(msg.trim());
    });
  }

  /*****************************************************************************
   *
   * Event handlers
   *
   ****************************************************************************/

  function transportStateChanged(transportState) {
    _self.emit('transport-state', transportState);
  }

  function favoritesChanged(favorites) {
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

  function isReady(cmdName) {
    if (_sonos) {
      return true;
    }
    var msg = '[SONOS] ' + cmdName + ' failed. Sonos unavilable.';
    log.error(msg);
    return false;
  }

  function isValidVolume(volume) {
    var newVolume = parseInt(volume, 10);
    if (isNaN(newVolume) || newVolume < 0 || newVolume > 100) {
      log.error('[SONOS] Volume is out of range:' + volume);
      return false;
    }
    return true;
  }

  function getPlayer(roomName) {
    if (isReady('getPlayer', false)) {
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
    if (isReady('applyPreset')) {
      _sonos.applyPreset(preset, function(error, response) {
        genericResponseHandler('applyPreset', error, response);
      });
      return true;
    }
    return false;
  };

  this.play = function(roomName) {
    if (isReady('play')) {
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
    return false;
  };

  this.stopAll = function() {
    if (isReady('stopAll')) {
      var zones = _sonos.getZones();
      var msg = '[SONOS] stopAll (';
      var zonesPaused = [];
      zones.forEach(function(zone) {
        var state = zone.coordinator.state.zoneState;
        if (state === 'PLAYING') {
          var speaker = _sonos.getPlayerByUUID(zone.uuid);
          zonesPaused.push(zone.zonename);
          speaker.pause(function(error, response) {
            genericResponseHandler('stopAll', error, response);
          });
        }
      });
      msg += zonesPaused.join(', ') + ')';
      log.log(msg);
      return true;
    }
    return false;
  };

  this.pause = function(roomName) {
    if (isReady('pause')) {
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
    return false;
  };

  this.next = function(roomName) {
    if (isReady('next')) {
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
    return false;
  };

  this.previous = function(roomName) {
    if (isReady('previous')) {
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
    return false;
  };

  this.setVolume = function(roomName, volume) {
    if (isReady('setVolume') && isValidVolume(volume)) {
      var speaker = getPlayer(roomName);
      if (speaker) {
        speaker.setVolume(volume.toString(), function(error, response) {
          genericResponseHandler('setVolume', error, response);
        });
        return true;
      }
      log.error('[SONOS] setVolume failed, unable to find speaker.');
      return false;
    }
    return false;
  };

  this.setVolumes = function(volumes) {
    if (isReady('setVolumes')) {
      volumes.forEach(function(room) {
        _self.setVolume(room.roomName, room.volume);
      });
    }
    return false;
  };

  this.volumeDown = function(roomName) {
    if (isReady('volumeDown')) {
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
    return false;
  };

  this.volumeUp = function(roomName) {
    if (isReady('volumeUp')) {
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
    return false;
  };

  this.getZones = function() {
    if (isReady('getZones')) {
      return _sonos.getZones();
    }
    return null;
  };

  this.getFavorites = function(callback) {
    if (isReady('getFavorites')) {
      var speaker = _sonos.getAnyPlayer();
      speaker.getFavorites(function(error, favorites) {
        if (callback) {
          callback(error, favorites);
        }
      });
      return true;
    }
    return false;
  };

  init();
}

util.inherits(Sonos, EventEmitter);

module.exports = Sonos;
