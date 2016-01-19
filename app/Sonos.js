'use strict';

var log = require('./SystemLog');
var EventEmitter = require('events').EventEmitter;
var util = require('util');
var SonosAPI = require('sonos');

function Sonos() {
  var _self = this;
  var _speakers = {};
  this.speakerInfo = {};
  var _dataUpdateTimer = null;
  var _speakerUpdateTimer = null;

  function init() {
    log.init('[SONOS] Init start.');
    process.on('SIGINT', handleSigInt);
    _speakers = {};
    searchForSpeakers();
    startUpdateTimer();
    _speakerUpdateTimer = setInterval(function() {
      searchForSpeakers();
    }, 90 * 1000);
    log.init('[SONOS] Init complete.');
  }

  /*****************************************************************************
   *
   * Base connect/disconnect functions
   *
   ****************************************************************************/

  this.shutdown = function() {
    log.log('[SONOS] Shutting down...');
    if (_speakerUpdateTimer) {
      clearInterval(_speakerUpdateTimer);
      _speakerUpdateTimer = null;
    }
    if (_dataUpdateTimer) {
      clearInterval(_dataUpdateTimer);
      _dataUpdateTimer = null;
    }
    _speakers = {};
    this.speakerInfo = {};
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


  /*****************************************************************************
   *
   * Internal help functions
   *
   ****************************************************************************/

  function searchForSpeakers() {
    log.log('[SONOS] Searching for Sonos speakers...');
    SonosAPI.search({timeout: 2500}, function(info, model) {
      log.debug('[SONOS] Found speaker: ' + model + ' at ' + info.host);
      if (model !== 'ANVIL') {
        var speaker = _speakers[info.host];
        if (!speaker) {
          speaker = new SonosAPI.Sonos(info.host);
          _speakers[info.host] = speaker;
          _self.speakerInfo[info.host] = {};
          updateCachedSpeakerInfo(info.host);
        }
      }
    });
  }

  function startUpdateTimer() {
    _dataUpdateTimer = setInterval(function() {
      var keys = Object.keys(_speakers);
      keys.forEach(function(host) {
        updateCachedSpeakerInfo(host);
      });
    }, 1500);
  }

  function genericResponseHandler(err, response) {
    if (err) {
      log.warn('[SONOS] genericResponseHandler error: ' + err);
    }
    if (response) {
      if (typeof response === 'object') {
        response = JSON.stringify(response);
      }
      log.debug('[SONOS] genericResponseHandler response: ' + response);
    }
  }

  function updateCachedSpeakerInfo(host) {
    var msg = '[SONOS] updateCachedSpeakerInfo (' + host + '): ';
    var speaker = _speakers[host];
    if (speaker) {
      // Should this be wrapped in try/catch, what if it doesn't exist any
      // more?
      speaker.deviceDescription(function(err, description) {
        if (err) {
          log.exception(msg + 'Unable to retreive device description.', err);
        }
        if (description) {
          _self.speakerInfo[host] = description;
        }
      });
      speaker.getCurrentState(function(err, state) {
        if (err) {
          log.exception(msg + 'Unable to get current state.', err);
        }
        if (state) {
          _self.speakerInfo[host].state = state;
        }
      });
      speaker.currentTrack(function(err, track) {
        if (err) {
          log.exception(msg + 'Unable to get current track', err);
        }
        if (track) {
          _self.speakerInfo[host].track = track;
        }
      });
      speaker.getZoneInfo(function(err, zoneInfo) {
        if (err) {
          log.exception(msg + 'Unable to get zone info', err);
        }
        if (zoneInfo) {
          _self.speakerInfo[host].zoneInfo = zoneInfo;
        }
      });
      speaker.getZoneAttrs(function(err, zoneAttrs) {
        if (err) {
          log.exception(msg + 'Unable to get zone attributes', err);
        }
        if (zoneAttrs) {
          _self.speakerInfo[host].zoneAttrs = zoneAttrs;
        }
      });
      speaker.getVolume(function(err, volume) {
        if (err) {
          log.exception(msg + 'Unable to get volume', err);
        }
        if (volume) {
          _self.speakerInfo[host].volume = volume;
        }
      });
      return true;
    }
    log.warn(msg + 'speaker does not exist at IP.');
    return false;
  }

  function getSpeakerByRoomName(roomName) {
    var msg = '[SONOS] getSpeakerByRoomName(' + roomName + ')';
    log.log(msg);
    var keys = Object.keys(_speakers);
    for (var i = 0; i < keys.length; i++) {
      var host = keys[i];
      var speakerInfo = _self.speakerInfo[host];
      if (speakerInfo) {
        if (speakerInfo.roomName === roomName) {
          var speaker = _speakers[host];
          return speaker;
        }
      }
    }
    log.error(msg + ' not found.');
    return null;
  }

  /*****************************************************************************
   *
   * Public API
   *
   ****************************************************************************/

  this.playURI = function(roomName, uri, volume) {
    log.log('[SONOS] playUri (' + roomName + ') ' + uri);
    var speaker = getSpeakerByRoomName(roomName);
    if (speaker) {
      speaker.play(uri, genericResponseHandler);
      if (volume) {
        speaker.setVolume(volume, genericResponseHandler);
      }
      return true;
    }
    log.error('[SONOS] playUri failed, speaker not found.');
    return false;
  };

  this.stopRoom = function(roomName) {
    log.log('[SONOS] stopRoom (' + roomName + ')');
    var speaker = getSpeakerByRoomName(roomName);
    if (speaker) {
      speaker.stop(genericResponseHandler);
      return true;
    }
    log.error('[SONOS] stopRoom failed, speaker not found.');
    return false;
  };

  this.stopAll = function() {
    log.log('[SONOS] stopAll');
    var keys = Object.keys(_speakers);
    keys.forEach(function(host) {
      var speaker = _speakers[host];
      log.debug('[SONOS] stopAll - ' + host);
      speaker.stop(genericResponseHandler);
    });
  };

  this.setVolume = function(roomName, volume, incrememtBy) {
    var msg = '[SONOS] setVolume (' + roomName + ') ';
    var speaker = getSpeakerByRoomName(roomName);
    if (speaker) {
      var cachedSpeaker = _self.speakerInfo[speaker.host];
      if (incrememtBy) {
        var currentVolume = cachedSpeaker.volume;
        if (currentVolume) {
          volume = parseInt(currentVolume) + parseInt(incrememtBy);
        }
      }
      volume = parseInt(volume);
      if (volume <= 100 && volume > 0) {
        log.debug(msg + 'to ' + volume);
        _self.speakerInfo[speaker.host].volume = volume;
        speaker.setVolume(volume, genericResponseHandler);
        return volume;
      }
      log.error(msg + ' failed, volume out of range: ' + volume);
      return false;
    }
    log.error(msg + 'failed, speaker not found.');
    return false;
  };

  init();
}

util.inherits(Sonos, EventEmitter);

module.exports = Sonos;
