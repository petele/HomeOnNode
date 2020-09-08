'use strict';

/* node14_ready */

const util = require('util');
const log = require('./SystemLog2');
const diff = require('deep-diff').diff;
const SonosSystem = require('sonos-discovery');
const EventEmitter = require('events').EventEmitter;

// Based on https://github.com/jishi/node-sonos-discovery

const LOG_PREFIX = 'SONOS';

/**
 * Sonos API.
 * @constructor
 *
 * @fires Sonos#transport-state
 * @fires Sonos#player-state
 * @fires Sonos#topology-changed
 * @fires Sonos#favorites-changed
*/
function Sonos() {
  const SERVICES_INTERVAL = 6 * 60 * 60 * 1000;
  let _ready = false;
  let _sonosSystem;
  let _favorites;
  let _services;
  const _self = this;

  /**
   * Execute a Sonos command.
   *
   * @param {Object} command The command to run.
   * @param {Object} presetOptions The preset options
      from /config/HomeOnNode/sonosPresetOptions
   * @return {Promise} The promise that will be resolved on completion.
  */
  this.executeCommand = function(command, presetOptions) {
    if (!_isReady()) {
      log.error(LOG_PREFIX, `Sonos is not ready`, command);
      return Promise.reject(new Error('not_ready'));
    }
    if (command.name === 'PRESET') {
      const preset = presetOptions[command.options];
      preset.uri = command.uri;
      return _applyPreset(preset);
    }
    if (command.name === 'PAUSE') {
      return _pause();
    }
    if (command.name === 'PLAY') {
      return _play();
    }
    if (command.name === 'NEXT') {
      return _next();
    }
    if (command.name === 'PREVIOUS') {
      return _previous();
    }
    if (command.name === 'VOLUME_UP') {
      return _volumeUp();
    }
    if (command.name === 'VOLUME_DOWN') {
      return _volumeDown();
    }
    if (command.name === 'MUTE') {
      const results = [];
      _arrayify(command.speakers).forEach((speaker) => {
        if (speaker === '_group') {
          results.push(_muteGroup(true));
        } else {
          results.push(_muteSpeaker(speaker, true));
        }
      });
      return Promise.all(results);
    }
    if (command.name === 'UNMUTE') {
      const results = [];
      _arrayify(command.speakers).forEach((speaker) => {
        if (speaker === '_group') {
          results.push(_muteGroup(false));
        } else {
          results.push(_muteSpeaker(speaker, false));
        }
      });
      return Promise.all(results);
    }
    if (command.name === 'SET_VOLUME') {
      const results = [];
      if (typeof command.speakers !== 'object') {
        return Promise.reject(new Error('invalid_speakers'));
      }
      const keys = Object.keys(command.speakers);
      keys.forEach((speaker) => {
        const vol = command.speakers[speaker];
        results.push(_setSpeakerVolume(speaker, vol));
      });
      return Promise.all(results);
    }
    log.error(LOG_PREFIX, 'Unknown command sent.', command);
    return Promise.reject(new Error('unknown_command'));
  };

  /**
   * Init
  */
  async function _init() {
    log.init(LOG_PREFIX, 'Starting...');
    _sonosSystem = new SonosSystem();

    _sonosSystem.on('initialized', () => {
      _ready = true;
      _getFavorites();
      _getServices();
      setInterval(_getServices, SERVICES_INTERVAL);
      log.debug(LOG_PREFIX, 'Ready.');
      _self.emit('ready');
    });

    // Queue changed
    _sonosSystem.on('queue-change', (player) => {
      _self.emit('queue-changed', player);
      log.verbose(LOG_PREFIX, 'Queue changed', player);
    });

    // List changed
    _sonosSystem.on('list-change', (listName) => {
      log.verbose(LOG_PREFIX, 'List changed', listName);
      if (listName === 'favorites') {
        _getFavorites();
      }
    });

    // Topology changed
    _sonosSystem.on('topology-changed', (zones) => {
      _self.emit('topology-changed', zones);
      log.verbose(LOG_PREFIX, 'Topology changed', zones);
    });

    // Transport state changed
    _sonosSystem.on('transport-state', (transportState) => {
      _self.emit('transport-state', transportState);
      const playerState = transportState.system.zones[0].coordinator.state;
      _self.emit('player-state', playerState);
      log.verbose(LOG_PREFIX, 'Player State Changed', playerState);
    });

    // Mute - single
    _sonosSystem.on('mute-change', (newVal) => {
      _self.emit('mute-changed', newVal);
      // log.verbose(LOG_PREFIX, 'Mute changed', newVal);
    });
    // Mute - group
    _sonosSystem.on('group-mute', (newVal) => {
      _self.emit('group-mute', newVal);
      // log.verbose(LOG_PREFIX, 'Group Mute changed', newVal);
    });

    // Volume - single
    _sonosSystem.on('volume-change', (newVal) => {
      _self.emit('volume-changed', newVal);
      // log.verbose(LOG_PREFIX, 'Volume changed', newVal);
    });
    // Volume - group
    _sonosSystem.on('group-volume', (newVal) => {
      _self.emit('group-volume', newVal);
      // log.verbose(LOG_PREFIX, 'Group volume changed', newVal);
    });

    _sonosSystem.on('listening', (listeningPort) => {
      _self.emit('listening', listeningPort);
      log.verbose(LOG_PREFIX, 'listening', listeningPort);
    });

    _sonosSystem.on('topology', (uuid, topology) => {
      _self.emit('topology', uuid, topology);
      log.verbose(LOG_PREFIX, 'Topology', uuid, topology);
    });

    _sonosSystem.on('last-change', (uuid, lastChange) => {
      _self.emit('last-changed', uuid, lastChange);
      log.verbose(LOG_PREFIX, 'Last change', uuid, lastChange);
    });

    _sonosSystem.on('queue-change', (uuid) => {
      _self.emit('queue-changed', uuid);
      log.verbose(LOG_PREFIX, 'Queue change', uuid);
    });

    _sonosSystem.on('found', (newVal) => {
      _self.emit('found', newVal);
      log.verbose(LOG_PREFIX, 'Found', newVal);
    });
  }

  /**
   * Checks if system is ready
   *
   * @return {Boolean} true if system is ready, false if not.
  */
  function _isReady() {
    if (_ready === true && _sonosSystem) {
      return true;
    }
    log.error(LOG_PREFIX, 'Command failed, Sonos system not ready.');
    return false;
  }

  /**
   * Take an object and turns it into an array
   *
   * @param {Object} val - Object to arrayify.
   * @return {Array} arrayified object.
   */
  function _arrayify(val) {
    if (Array.isArray(val)) {
      return val;
    }
    return [val];
  }

  /**
   * Gets Sonos Player
   *
   * @param {string} roomName The name of the player to return (optional).
   * @param {boolean} strict Only select the named speaker.
   * @return {Object} A Sonos Player.
  */
  function _getPlayer(roomName, strict) {
    let player;
    if (roomName) {
      player = _sonosSystem.getPlayer(roomName);
      if (player) {
        return player;
      }
      if (strict === true) {
        return null;
      }
    }
    try {
      const uuid = _sonosSystem.zones[0].uuid;
      player = _sonosSystem.getPlayerByUUID(uuid);
      if (player) {
        return player;
      }
    } catch (ex) {
      log.warn(LOG_PREFIX, 'Unable to get zone 0 player');
      player = _sonosSystem.getAnyPlayer();
    }
    return player;
  }

  /**
   * Set specific speaker volume.
   *
   * @param {string} speakerName Name of speaker to adjust.
   * @param {number} vol The level to set the speaker to.
   * @return {Promise} The promise that will be resolved on completion.
  */
  function _setSpeakerVolume(speakerName, vol) {
    const msg = `setSpeakerVolume('${speakerName}', ${vol})`;
    const speaker = _getPlayer(speakerName, true);
    if (!speaker) {
      log.error(LOG_PREFIX, `${msg} failed, speaker not found.`);
      return Promise.reject(new Error('speaker_not_found'));
    }
    log.debug(LOG_PREFIX, msg);
    return speaker.setVolume(vol)
        .then((result) => {
          const newVal = {
            uuid: speaker.uuid,
            roomName: speaker.roomName,
            newVolume: vol,
          };
          _self.emit('volume-changed', newVal);
          return result;
        })
        .catch((err) => {
          log.exception(LOG_PREFIX, `${msg} failed, with exception.`, err);
          return {success: false};
        });
  }

  /**
   * Increment/decrement the whole system volume.
   *
   * @param {string} vol The increment/decrement amount, ie: +2, -2, etc.
   * @return {Promise} The promise that will be resolved on completion.
  */
  function _adjustVolume(vol) {
    const msg = `adjustVolume(${vol})`;
    return Promise.all(
        _sonosSystem.zones.map((zone) => {
          const player = _sonosSystem.getPlayerByUUID(zone.uuid);
          if (!player) {
            log.error(LOG_PREFIX, `${msg} failed, group not found.`, zone.uuid);
            return Promise.resolve({success: false});
          }
          log.verbose(LOG_PREFIX, `${msg} (${zone.uuid})`);
          return player.coordinator.setGroupVolume(vol)
              .catch((err) => {
                log.exception(LOG_PREFIX, `${msg} failed.`, err);
                return {success: false};
              });
        }));
  }

  /**
   * Mute or unmute a specific speaker
   *
   * @param {string} speakerName Name of speaker to adjust.
   * @param {boolean} muted If the speaker should be muted or not.
   * @return {Promise} The promise that will be resolved on completion.
   */
  function _muteSpeaker(speakerName, muted) {
    const msg = `muteSpeaker('${speakerName}', ${muted})`;
    const speaker = _getPlayer(speakerName, true);
    if (!speaker) {
      log.error(LOG_PREFIX, `${msg} failed, speaker not found.`);
      return Promise.reject(new Error('speaker_not_found'));
    }
    log.debug(LOG_PREFIX, msg);
    if (muted) {
      return speaker.mute();
    }
    return speaker.unMute();
  }

  /**
   * Mute or unmute the whole system
   *
   * @param {boolean} muted If the system should be muted or not.
   * @return {Promise} The promise that will be resolved on completion.
   */
  function _muteGroup(muted) {
    const msg = `muteGroup(${muted})`;
    return Promise.all(
        _sonosSystem.zones.map((zone) => {
          const player = _sonosSystem.getPlayerByUUID(zone.uuid);
          if (!player) {
            log.error(LOG_PREFIX, `${msg} failed, group not found.`, zone.uuid);
            return Promise.resolve({success: false});
          }
          log.verbose(LOG_PREFIX, `${msg} (${zone.uuid})`);
          if (muted) {
            return player.coordinator.muteGroup()
                .catch((err) => {
                  log.exception(LOG_PREFIX, `${msg} failed.`, err);
                  return {success: false};
                });
          }
          return player.coordinator.unMuteGroup()
              .catch((err) => {
                log.exception(LOG_PREFIX, `${msg} failed.`, err);
                return {success: false};
              });
        }));
  }

  /**
   * Update Favorites
   *
   * Fires an event (favorites-changed) when the favorites have been updated.
  */
  function _getFavorites() {
    if (!_isReady()) {
      return;
    }
    // const player = _getPlayer();
    // player.system.getFavorites().then((favs) => {
    _sonosSystem.getFavorites().then((favs) => {
      if (diff(_favorites, favs)) {
        log.verbose(LOG_PREFIX, 'Favorites changed.', favs);
        _self.emit('favorites-changed', favs);
        _favorites = favs;
      }
    }).catch((err) => {
      log.exception(LOG_PREFIX, 'Error in getFavorites', err);
    });
  }

  /**
   * Get list of available services
   *
   * Fires an event (services-changed) when the services have been updated.
  */
  function _getServices() {
    if (!_isReady()) {
      return;
    }
    if (!_sonosSystem.availableServices) {
      _services = {};
      log.warn(LOG_PREFIX, 'No services available...');
      return;
    }
    try {
      const stringified = JSON.stringify(_sonosSystem.availableServices);
      const services = JSON.parse(stringified);
      if (diff(_services, services)) {
        log.verbose(LOG_PREFIX, 'Services changed.', services);
        _services = services;
        _self.emit('services-changed', services);
      }
    } catch (ex) {
      log.exception(LOG_PREFIX, 'Unable to get services', ex);
    }
  }

  /**
   * Applies a Sonos Preset
   *
   * @param {Object} preset The settings to apply.
   * @return {Promise} The promise that will be resolved on completion.
  */
  function _applyPreset(preset) {
    log.debug(LOG_PREFIX, 'applyPreset()', preset);
    return _sonosSystem.applyPreset(preset);
  }

  /**
   * Play.
   *
   * @return {Promise} The promise that will be resolved on completion.
  */
  function _play() {
    log.debug(LOG_PREFIX, 'play()');
    const player = _getPlayer();
    if (!player) {
      return Promise.reject(new Error('speaker_not_found'));
    }
    return player.play();
  }

  /**
   * Pause.
   *
   * @return {Promise} The promise that will be resolved on completion.
  */
  function _pause() {
    // todo move after is ready
    log.debug(LOG_PREFIX, 'pause()');
    return Promise.all(
        _sonosSystem.zones.filter((zone) => {
          return zone.coordinator.state.playbackState === 'PLAYING';
        })
            .map((zone) => {
              const player = _sonosSystem.getPlayerByUUID(zone.uuid);
              return player.pause()
                  .catch((err) => {
                    const uuid = zone.uuid;
                    log.exception(LOG_PREFIX, `Error pausing ${uuid}`, err);
                    return {success: false};
                  });
            }));
  }

  /**
   * Next.
   *
   * @return {Promise} The promise that will be resolved on completion.
  */
  function _next() {
    log.debug(LOG_PREFIX, 'next()');
    const player = _getPlayer();
    if (!player) {
      return Promise.reject(new Error('speaker_not_found'));
    }
    return player.nextTrack();
  }

  /**
   * Previous.
   *
   * @return {Promise} The promise that will be resolved on completion.
  */
  function _previous() {
    log.debug(LOG_PREFIX, 'previous()');
    const player = _getPlayer();
    if (!player) {
      return Promise.reject(new Error('speaker_not_found'));
    }
    return player.previousTrack();
  }

  /**
   * Volume Down.
   *
   * @return {Promise} The promise that will be resolved on completion.
  */
  function _volumeDown() {
    log.debug(LOG_PREFIX, 'volumeDown()');
    return _adjustVolume('-2');
  }

  /**
   * Volume Up.
   *
   * @return {Promise} The promise that will be resolved on completion.
  */
  function _volumeUp() {
    log.debug(LOG_PREFIX, 'volumeUp()');
    return _adjustVolume('+2');
  }

  return _init()
      .then(() => {
        return _self;
      });
}

util.inherits(Sonos, EventEmitter);

module.exports = Sonos;
