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
    logIt: function(level, args) {
      var PREFIX = 'SONOS*';
      var msg = '';
      var extras;
      var argsAsArray = Array.prototype.slice.call(args);
      if (argsAsArray.length === 0) {
        msg = 'Blank log message. :(';
      } else if (argsAsArray.length === 1) {
        msg = argsAsArray[0];
      } else if (argsAsArray.length === 2) {
        msg = argsAsArray[0];
        extras = argsAsArray[1];
      } else {
        msg = argsAsArray.shift();
        extras = argsAsArray;
      }
      if (level === 'LOG') {
        log.log(PREFIX, msg, extras);
      } else if (level === 'ERROR') {
        log.error(PREFIX, msg, extras);
      } else {
        log.debug(PREFIX, msg, extras);
      }
    },
    info: function() {
      this.logIt('LOG', arguments);
    },
    error: function() {
      this.logIt('ERROR', arguments);
    },
    debug: function() {
      this.logIt('DEBUG', arguments);
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
    var msg = 'genericResponseHandler - ' + apiName;
    if (error) {
      log.error(LOG_PREFIX, msg, error);
    } else {
      // log.debug(LOG_PREFIX, msg, response);
      log.debug(LOG_PREFIX, msg);
    }
  }


  /*****************************************************************************
   *
   * Public API
   *
   ****************************************************************************/

  this.pete = function() {
    return _sonos;
  };

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
      var speakers = [];
      if (roomName) {
        speakers.push(roomName);
      } else {
        _sonos.getZones().forEach(function(zone) {
          speakers.push(zone.coordinator.roomName);
        });
      }
      speakers.forEach(function(rName) {
        var speaker = getPlayer(rName);
        // console.log('s', util.inspect(speaker, {depth:3, colors:true}));
        if (speaker.state.currentState !== 'STOPPED') {
          speaker.pause(function(error, response) {
            var msg = 'pause (' + rName + ')';
            genericResponseHandler(msg, error, response);
          });        
        }
      });
      return true;
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
    if (_sonos) {
      var speaker = _sonos.getAnyPlayer();
      speaker.getFavorites(function(err, favs) {
        favoritesChanged(favs);
      });
    }
  };

  init();
}

util.inherits(Sonos, EventEmitter);

module.exports = Sonos;
