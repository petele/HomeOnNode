'use strict';

var log = require('./SystemLog2');
var EventEmitter = require('events').EventEmitter;
var util = require('util');
var SonosDiscovery = require('./sonos-discovery/lib/sonos.js');

// Based on https://github.com/jishi/node-sonos-discovery

var LOG_PREFIX = 'SONOS';

function Sonos() {
  var _self = this;
  var _sonos;
  var _favorites = {};

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
      log.log('[SONOS*]',this.stringify(arguments));
    },
    error: function() {
      log.error('[SONOS*]', this.stringify(arguments));
    },
    debug: function() {
      log.debug('[SONOS*]', this.stringify(arguments));
    }
  };

  function init() {
    log.init(LOG_PREFIX, 'Init start.');
    process.on('SIGINT', handleSigInt);
    _sonos = new SonosDiscovery({log: _logger});
    _sonos.on('transport-state', transportStateChanged);
    _sonos.on('favorites-change', favoritesChanged);
    _sonos.on('topology-change', topologyChanged);
    log.init(LOG_PREFIX, 'Init complete.');
  }

  /*****************************************************************************
   *
   * Base connect/disconnect functions
   *
   ****************************************************************************/

  this.shutdown = function() {
    log.log(LOG_PREFIX, 'Shutting down...');
    // TODO
    return true;
  };


  /*****************************************************************************
   *
   * Event handlers
   *
   ****************************************************************************/

  function handleSigInt() {
    log.log(LOG_PREFIX, 'SIGINT received.');
    _self.shutdown();
  }

  function transportStateChanged(transportState) {
    _self.emit('transport-state', transportState);
  }

  function favoritesChanged(favorites) {
    _favorites = favorites;
    _self.emit('favorites-changed', favorites);
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
        log.debug(LOG_PREFIX, 'getPlayer: ' + speaker.roomName);
        return speaker;
      }
      speaker = _sonos.getAnyPlayer();
      if (speaker) {
        log.debug(LOG_PREFIX, 'getPlayer: ' + speaker.roomName);
        return speaker;
      }
    }
    log.error(LOG_PREFIX, 'getPlayer failed, no speakers found.');
    return null;
  }

  function genericResponseHandler(apiName, error, response) {
    var msg = '[SONOS] genericResponseHandler - ' + apiName;
    if (response) {
      try {
        msg += ': ' + util.inspect(response);
      } catch (ex) {
        var exMsg = 'Unable to stringify response: ' + response;
        log.exception(LOG_PREFIX, exMsg, ex);
        msg += ': ' + response;
      }
    }
    if (error) {
      log.error(LOG_PREFIX, msg + ' -- ' + error.toString(), error);
    } else {
      log.debug(LOG_PREFIX, msg);
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
    log.error(LOG_PREFIX, 'applyPreset failed, Sonos unavilable.');
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
      log.error(LOG_PREFIX, 'play failed, unable to find speaker.');
      return false;
    }
    log.error(LOG_PREFIX, 'play failed, Sonos unavilable.');
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
      log.error(LOG_PREFIX, 'pause failed, unable to find speaker.');
      return false;
    }
    log.error(LOG_PREFIX, 'pause failed, Sonos unavilable.');
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
      log.error(LOG_PREFIX, 'next failed, unable to find speaker.');
      return false;
    }
    log.error(LOG_PREFIX, 'next failed, Sonos unavilable.');
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
      log.error(LOG_PREFIX, 'previous failed, unable to find speaker.');
      return false;
    }
    log.error(LOG_PREFIX, 'previous failed, Sonos unavilable.');
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
      log.error(LOG_PREFIX, 'volumeDown failed, unable to find speaker.');
      return false;
    }
    log.error(LOG_PREFIX, 'volumeDown failed, Sonos unavilable.');
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
      log.error(LOG_PREFIX, 'volumeUp failed, unable to find speaker.');
      return false;
    }
    log.error(LOG_PREFIX, 'volumeUp failed, Sonos unavilable.');
    return false;
  };

  this.getZones = function() {
    if (_sonos) {
      return _sonos.getZones();
    }
    log.error(LOG_PREFIX, 'getZones failed, Sonos unavilable.');
    return null;
  };

  this.getFavorites = function() {
    return _favorites;
  };

  init();
}

util.inherits(Sonos, EventEmitter);

module.exports = Sonos;
