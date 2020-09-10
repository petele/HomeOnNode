'use strict';

const util = require('util');
const log = require('./SystemLog2');
// const diff = require('deep-diff').diff;
const EventEmitter = require('events').EventEmitter;
const appleTV = require('node-appletv-x');

const LOG_PREFIX = 'APPLE_TV';

/**
 * AppleTV API.
 * @constructor
 *
 * @see https://github.com/stickpin/node-appletv-x
 *
*/
function AppleTV() {
  let _appleTV;
  let _ready = false;
  let _pairCallback;
  const _self = this;

  // /**
  //  * Init
  //  */
  // async function _init() {
  //   log.init(LOG_PREFIX, 'Starting...');

  //   await _findAppleTV();
  //   if (!_appleTV) {
  //     log.error(LOG_PREFIX, 'Aborting, unable to find AppleTV');
  //     return;
  //   }
  //   _appleTV.on('close', _onClose);
  //   _appleTV.on('connect', _onConnect);
  //   _appleTV.on('error', _onError);
  //   _appleTV.on('message', _onMessage);
  //   _appleTV.on('nowPlaying', _onNowPlaying);
  //   _appleTV.on('playbackqueue', _onPlaybackQueue);
  //   _appleTV.on('supportedCommands', _onSupportedCommands);
  //   _self.emit('found');
  // }

  this.connect = async function(credentials) {
    if (_appleTV) {
      return true;
    }
    log.init(LOG_PREFIX, 'Searching...');
    await _findAppleTV();
    _appleTV.on('close', _onClose);
    _appleTV.on('connect', _onConnect);
    _appleTV.on('error', _onError);
    _appleTV.on('message', _onMessage);
    _appleTV.on('nowPlaying', _onNowPlaying);
    _appleTV.on('playbackqueue', _onPlaybackQueue);
    _appleTV.on('supportedCommands', _onSupportedCommands);
    log.log(LOG_PREFIX, 'Connecting...');
    try {
      const credObj = appleTV.parseCredentials(credentials);
      await _appleTV.openConnection(credObj);
      return true;
    } catch (ex) {
      log.exception(LOG_PREFIX, 'Error trying to connect', ex);
    }
    return false;
  };

  /**
   * Finds an Apple TV
   */
  async function _findAppleTV() {
    log.verbose(LOG_PREFIX, 'Searching for AppleTV...');
    try {
      const devices = await appleTV.scan();
      if (devices && devices.length >= 1) {
        _appleTV = devices[0];
        log.verbose(LOG_PREFIX, 'Found Apple TV', _appleTV.service.txt);
        _self.emit('found', _appleTV.service.txt);
        return;
      }
    } catch (ex) {
      log.exception(LOG_PREFIX, 'Error trying to find AppleTV', ex);
    }
    return _findAppleTV();
  }

  /**
   * Run on close.
   */
  function _onClose() {
    log.warn(LOG_PREFIX, 'EVENT - close');
    _ready = false;
    _self.emit('closed');
  }

  /**
   * Run on connect
   */
  function _onConnect() {
    log.log(LOG_PREFIX, 'Connected.');
    _ready = true;
    _self.emit('ready');
  }

  /**
   * Error handler
   * @param {Error} err
   */
  function _onError(err) {
    log.error(LOG_PREFIX, 'Generic Error', err);
  }

  /**
   * Message Handler
   * @param {Object} message
   */
  function _onMessage(message) {
    // log.log(LOG_PREFIX, 'Message', message);
  }

  /**
   * Now Playing Handler
   * @param {Object} nowPlaying
   */
  function _onNowPlaying(nowPlaying) {
    log.log(LOG_PREFIX, 'Now Playing', nowPlaying);
    _self.emit('nowPlaying', nowPlaying);
  }

  /**
   * Playback Queue Handler
   * @param {Object} playbackQueue
   */
  function _onPlaybackQueue(playbackQueue) {
    log.log(LOG_PREFIX, 'Playback Queue', playbackQueue);
    _self.emit('playbackQueue', playbackQueue);
  }

  /**
   * Supported Commands Handler
   * @param {Object} commands
   */
  function _onSupportedCommands(commands) {
    log.log(LOG_PREFIX, 'Supported Commands', commands);
    _self.emit('supportedCommands', commands);
  }

  /**
   * Executes an AppleTV command
   *
   * @param {Object} command Command to execute.
   * @return {Object} result of executed command
   */
  this.execute = function(command) {
    if (_ready) {
      return {success: false};
    }
    return {success: false, ready: false};
  };

  this.pairBegin = async function() {
    if (!_appleTV) {
      log.error(LOG_PREFIX, 'No AppleTV found...');
      return false;
    }
    await _appleTV.openConnection();
    _pairCallback = await _appleTV.pair();
    log.log(LOG_PREFIX, 'Check TV screen for PIN code, call pairComplete');
    return true;
  };

  this.pairComplete = async function(pin) {
    if (!_appleTV) {
      log.error(LOG_PREFIX, 'No AppleTV found...');
      return false;
    }
    if (!_pairCallback) {
      log.error(LOG_PREFIX, 'Must call pairBegin first.');
      return;
    }
    await _pairCallback(pin);
    const credentials = _appleTV.credentials.toString();
    log.log(LOG_PREFIX, `Pair completed, please save credentials`, credentials);
    return credentials;
  };

  this.shutdown = function() {
    if (_appleTV) {
      _appleTV.closeConnection();
    }
  };

  // return _init()
  //     .then(() => {
  //       return _self;
  //     });
}

util.inherits(AppleTV, EventEmitter);

module.exports = AppleTV;
