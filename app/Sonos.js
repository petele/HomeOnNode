'use strict';

const log = require('./SystemLog2');
const EventEmitter = require('events').EventEmitter;
const util = require('util');
const SonosSystem = require('sonos-discovery');

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
  const FAV_INTERVAL = 12 * 60 * 1000;
  let _ready = false;
  let _sonosSystem;
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
    if (_isReady() !== true) {
      return Promise.reject(new Error('not_ready'));
    }
    if (command.name === 'PRESET') {
      let preset = presetOptions[command.options];
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
    return Promise.reject(new Error('unknown_command'));
  };

  /**
   * Init
  */
  function _init() {
    log.init(LOG_PREFIX, 'Starting...');
    _sonosSystem = new SonosSystem();
    _sonosSystem.on('initialized', () => {
      _ready = true;
      log.log(LOG_PREFIX, 'Ready.');
      _self.emit('ready');
      _getFavorites();
      setInterval(_getFavorites, FAV_INTERVAL);
    });
    _sonosSystem.on('transport-state', (transportState) => {
      /**
       * Fired when the transport has changed
       * @event Sonos#transport-state
       */
      _self.emit('transport-state', transportState);
      const playerState = transportState.system.zones[0].coordinator.state;
      /**
       * Fired when the player state changes
       * @event Sonos#player-state
       */
      _self.emit('player-state', playerState);
      log.verbose(LOG_PREFIX, 'Player State Changed');
    });
    _sonosSystem.on('topology-changed', (zones) => {
      /**
       * Fired when the player state changes
       * @event Sonos#topology-changed
       */
      _self.emit('topology-changed', zones);
      log.verbose(LOG_PREFIX, 'Topology changed');
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
   * Gets Sonos Player
   *
   * @param {string} roomName The name of the player to return (optional).
   * @return {Object} A Sonos Player.
  */
  function _getPlayer(roomName) {
    let player;
    if (roomName) {
      player = _sonosSystem.getPlayer(roomName);
      if (player) {
        return player;
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
   * Increment/decrement the whole system volume.
   *
   * @param {string} vol The increment/decrement amount, ie: +2, -2, etc.
   * @return {Promise} The promise that will be resolved on completion.
  */
  function _adjustVolume(vol) {
    return Promise.all(
      _sonosSystem.zones.map((zone) => {
        const player = _sonosSystem.getPlayerByUUID(zone.uuid);
        return player.coordinator.setGroupVolume(vol);
      })
    );
  }

  /**
   * Update Favorites
   *
   * Fires an event (favorites-changed) when the favorites have been updated.
  */
  function _getFavorites() {
    if (_isReady() !== true) {
      return;
    }
    let player = _getPlayer();
    player.system.getFavorites().then((favs) => {
      /**
       * Fired when the list of favorites change
       * @event Sonos#favorites-changed
       */
      _self.emit('favorites-changed', favs);
      log.verbose(LOG_PREFIX, 'Favorites changed.');
    });
  }

  /**
   * Applies a Sonos Preset
   *
   * @param {Object} preset The settings to apply.
   * @return {Promise} The promise that will be resolved on completion.
  */
  function _applyPreset(preset) {
    log.log(LOG_PREFIX, 'applyPreset()', preset);
    if (_isReady() !== true) {
      return Promise.reject(new Error('not_ready'));
    }
    return _sonosSystem.applyPreset(preset);
  }

  /**
   * Play.
   *
   * @return {Promise} The promise that will be resolved on completion.
  */
  function _play() {
    log.log(LOG_PREFIX, 'play()');
    if (_isReady() !== true) {
      return Promise.reject(new Error('not_ready'));
    }
    let player = _getPlayer();
    return player.play();
  }

  /**
   * Pause.
   *
   * @return {Promise} The promise that will be resolved on completion.
  */
  function _pause() {
    log.log(LOG_PREFIX, 'pause()');
    if (_isReady() !== true) {
      return Promise.reject(new Error('not_ready'));
    }
    return Promise.all(
      _sonosSystem.zones.filter((zone) => {
        return zone.coordinator.state.playbackState === 'PLAYING';
      })
      .map((zone) => {
        const player = _sonosSystem.getPlayerByUUID(zone.uuid);
        return player.pause();
      })
    );
  }

  /**
   * Next.
   *
   * @return {Promise} The promise that will be resolved on completion.
  */
  function _next() {
    log.log(LOG_PREFIX, 'next()');
    if (_isReady() !== true) {
      return Promise.reject(new Error('not_ready'));
    }
    let player = _getPlayer();
    return player.nextTrack();
  }

  /**
   * Previous.
   *
   * @return {Promise} The promise that will be resolved on completion.
  */
  function _previous() {
    log.log(LOG_PREFIX, 'previous()');
    if (_isReady() !== true) {
      return Promise.reject(new Error('not_ready'));
    }
    let player = _getPlayer();
    return player.previousTrack();
  }

  /**
   * Volume Down.
   *
   * @return {Promise} The promise that will be resolved on completion.
  */
  function _volumeDown() {
    log.log(LOG_PREFIX, 'volumeDown()');
    if (_isReady() !== true) {
      return Promise.reject(new Error('not_ready'));
    }
    return _adjustVolume('-2');
  }

  /**
   * Volume Up.
   *
   * @return {Promise} The promise that will be resolved on completion.
  */
  function _volumeUp() {
    log.log(LOG_PREFIX, 'volumeUp()');
    if (_isReady() !== true) {
      return Promise.reject(new Error('not_ready'));
    }
    return _adjustVolume('+2');
  }

  _init();
}

util.inherits(Sonos, EventEmitter);

module.exports = Sonos;
