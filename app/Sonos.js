'use strict';

var log = require('./SystemLog');
var EventEmitter = require('events').EventEmitter;
var util = require('util');
var SonosAPI = require('sonos');

// TODO: Check out https://github.com/jishi/node-sonos-discovery/

// TODO: Investigate storing speakers by Zone insead of IP

// Current API - https://github.com/bencevans/node-sonos/blob/master/API.md

function Sonos() {
  var _self = this;
  var _speakers = {};
  this.speakerInfo = {};
  var _dataUpdateTimer = null;
  var _speakerUpdateTimer = null;

  var dataRefreshInterval = 1500;
  var speakerRefreshInterval = 90 * 1000;

  function init() {
    log.init('[SONOS] Init start.');
    process.on('SIGINT', handleSigInt);
    _speakers = {};
    searchForSpeakers();

    // Set up interval to refresh speaker list
    _speakerUpdateTimer = setInterval(function() {
      searchForSpeakers();
    }, speakerRefreshInterval);

    // Set up interval to refresh speaker data
    _dataUpdateTimer = setInterval(function() {
      var keys = Object.keys(_speakers);
      keys.forEach(function(host) {
        updateCachedSpeakerInfo(host);
      });
    }, dataRefreshInterval);

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
    _self.speakerInfo = {};
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
    SonosAPI.search({timeout: 2500}, function(info, model) {
      if (model !== 'ANVIL') {
        var speaker = _speakers[info.host];
        if (!speaker) {
          log.debug('[SONOS] Found new speaker: ' + model + ' at ' + info.host);
          speaker = new SonosAPI.Sonos(info.host);
          _speakers[info.host] = speaker;
          _self.speakerInfo[info.host] = {};
          updateCachedSpeakerInfo(info.host);
        }
      }
    });
  }

  function removeSpeaker(host) {
    var msg = '[SONOS] Removing speaker (' + host + '): ';
    if (_speakers[host]) {
      _speakers[host] = null;
      msg += '[speaker] ';
    }
    if (_self.speakerInfo[host]) {
      _self.speakerInfo[host] = null;
      msg += '[speakerInfo]';
    }
    log.log(msg);
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
      speaker.deviceDescription(function(err, description) {
        if (err) {
          log.exception(msg + 'Unable to retreive device description.', err);
          removeSpeaker(host);
        }
        if (description) {
          description.deviceList = {};
          _self.speakerInfo[host].description = description;
        }
      });
    }
    if (speaker) {
      speaker.getCurrentState(function(err, state) {
        if (err) {
          log.exception(msg + 'Unable to get current state.', err);
          removeSpeaker(host);
        }
        if (state) {
          _self.speakerInfo[host].state = state;
        }
      });
    }
    if (speaker) {
      speaker.currentTrack(function(err, track) {
        if (err) {
          log.exception(msg + 'Unable to get current track', err);
          removeSpeaker(host);
        }
        if (track) {
          _self.speakerInfo[host].track = track;
        }
      });
    }
    if (speaker) {
      speaker.getZoneInfo(function(err, zoneInfo) {
        if (err) {
          log.exception(msg + 'Unable to get zone info', err);
          removeSpeaker(host);
        }
        if (zoneInfo) {
          _self.speakerInfo[host].zoneInfo = zoneInfo;
        }
      });
    }
    if (speaker) {
      speaker.getZoneAttrs(function(err, zoneAttrs) {
        if (err) {
          log.exception(msg + 'Unable to get zone attributes', err);
          removeSpeaker(host);
        }
        if (zoneAttrs) {
          _self.speakerInfo[host].zoneAttrs = zoneAttrs;
        }
      });
    }
    if (speaker) {
      speaker.getVolume(function(err, volume) {
        if (err) {
          log.exception(msg + 'Unable to get volume', err);
          removeSpeaker(host);
        }
        if (volume) {
          _self.speakerInfo[host].volume = volume;
        }
      });
    }
    if (speaker) {
      return true;
    }
    log.warn(msg + 'speaker does not exist at IP.');
    return false;
  }

  function getSpeakerByRoomName(roomName) {
    var keys = Object.keys(_speakers);
    for (var i = 0; i < keys.length; i++) {
      var host = keys[i];
      if (host) {
        var speakerInfo = _self.speakerInfo[host];
        if (speakerInfo) {
          if (speakerInfo.description.roomName === roomName) {
            var speaker = _speakers[host];
            return speaker;
          }
        }
      }
    }
    log.error('[SONOS] getSpeakerByRoomName(' + roomName + ') not found.');
    return null;
  }


  /*****************************************************************************
   *
   * Public API
   *
   ****************************************************************************/

  this.playURI = function(roomName, uri, volume) {
    var msg = '[SONOS] playUri (' + roomName + ') ' + uri;
    var speaker = getSpeakerByRoomName(roomName);
    if (speaker) {
      speaker.play(uri, genericResponseHandler);
      if (volume) {
        speaker.setVolume(volume, genericResponseHandler);
        msg += ' [' + volume + ']';
      }
      log.log(msg);
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
        } else {
          log.error(msg + 'failed, unable to retreive current volume.');
          return false;
        }
      }
      volume = parseInt(volume);
      if (volume <= 100 && volume > 0) {
        log.log(msg + 'to ' + volume);
        speaker.setVolume(volume, genericResponseHandler);
        _self.speakerInfo[speaker.host].volume = volume;
        return volume;
      }
      log.error(msg + ' failed, volume out of range: ' + volume);
      return false;
    }
    log.error(msg + 'failed, speaker not found.');
    return false;
  };

  this.setMuted = function(roomName, muted) {
    log.log('[SONOS] setMuted (' + roomName + ') ' + muted);
    var speaker = getSpeakerByRoomName(roomName);
    if (speaker) {
      speaker.setMuted(muted, genericResponseHandler);
      return true;
    }
    log.error('[SONOS] setMuted failed, speaker not found.');
    return false;
  };

  init();
}

util.inherits(Sonos, EventEmitter);

module.exports = Sonos;
