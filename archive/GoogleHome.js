'use strict';

const util = require('util');
const request = require('request');
const log = require('./SystemLog2');
const tts = require('google-tts-api');
const diff = require('deep-diff').diff;
const castv2 = require('castv2-client');
const EventEmitter = require('events').EventEmitter;

const LOG_PREFIX = 'GOOGLE_HOME';

/**
 * Google Home API.
 * @constructor
 *
 * @see https://rithvikvibhu.github.io/GHLocalApi/
 * @see https://developers.google.com/cast/docs/media
 *
 * @see https://github.com/ghostrick/node-googlehome/blob/master/lib/search.js
 * @see https://developers.google.com/assistant/smarthome/develop/local
 * @see https://medium.com/google-cloud/building-your-first-action-for-google-home-in-30-minutes-ec6c65b7bd32
 * @see https://github.com/oznu/homebridge-gsh
 * @see https://github.com/actions-on-google/smart-home-nodejs
 *
 * @param {string} ipAddress IP Address of the Google Home
*/
function GoogleHome(ipAddress) {
  const _self = this;
  let _ready = false;

  this.deviceInfo = {};

  const REFRESH_INTERVAL = 7 * 60 * 1000;

  /**
   * Init.
   */
  function _init() {
    log.init(LOG_PREFIX, 'Starting...', {ipAddress: ipAddress});
    _getDeviceInfo();
    setInterval(() => {
      _getDeviceInfo();
    }, REFRESH_INTERVAL);
  }

  /**
   * Check if the API is ready, throws a warning if it isn't.
   *
   * @return {boolean} True if ready, false if not.
   */
  function _isReady() {
    return _ready === true;
  }

  /**
   * Makes the Google Home say the specific utterance.
   *
   * @param {string} utterance The utterance the Google Home should say.
   * @return {Promise}
   */
  this.say = function(utterance) {
    const msg = `say('${utterance}')`;
    if (!_isReady()) {
      log.error(LOG_PREFIX, `${msg} failed, not ready.`);
      return Promise.reject(new Error('not_ready'));
    }
    log.debug(LOG_PREFIX, msg);
    // const opts = {
    //   metadata: {
    //     metadataType: 0,
    //     title: utterance,
    //     subtitle: 'HomeOnNode',
    //     images: [{
    //       url: 'https://gdrinker.com/images/sadpanda.png',
    //       width: 200,
    //       height: 300,
    //     }],
    //   },
    // };
    // if (volume && volume <= 100 && volume > 0) {
    //   opts.volume = volume / 100;
    // }
    return tts(utterance, 'en', 1).then((url) => {
      return _self.play(url);
    });
  };

  /**
   * Get a CastV2 Client
   *
   * @return {Promise} cast client.
   */
  function _getCastClient() {
    return new Promise((resolve, reject) => {
      const client = new castv2.Client();

      client.on('error', (err) => {
        log.error(LOG_PREFIX, 'Client error', err);
        client.close();
        reject(err);
      });

      client.connect(ipAddress, () => {
        resolve(client);
      });
    });
  }

  /**
   * Makes the Google Home to set the volume.
   *
   * @param {number} level Volume level (1-100).
   * @return {number}
   */
  this.setVolume = function(level) {
    const msg = `setVolume(${level})`;
    if (!_isReady()) {
      log.error(LOG_PREFIX, `${msg} failed, not ready.`);
      return Promise.reject(new Error('not_ready'));
    }
    log.debug(LOG_PREFIX, msg);
    if (level > 100 || level < 1) {
      log.error(LOG_PREFIX, `${msg} failed, level out of bounds.`);
      return Promise.reject(new Error('level_out_of_bounds'));
    }
    return _getCastClient()
        .then((client) => {
          return new Promise((resolve, reject) => {
            client.setVolume({level: level / 100}, (err, resp) => {
              client.close();
              if (err) {
                log.error(LOG_PREFIX, 'Unable to set volume', err);
                reject(err);
                return;
              }
              resolve(resp);
            });
          });
        });
  };


  /**
   * Makes the Google Home play the specific URL.
   *
   * @param {string} url A sound URL to play.
   * @param {Object} [options]
   * @return {Promise}
   */
  this.play = function(url, options) {
    options = options || {};
    const msg = `play('${url}', {...})`;
    if (!_isReady()) {
      log.error(LOG_PREFIX, `${msg} failed, not ready.`, options);
      return Promise.reject(new Error('not_ready'));
    }
    log.debug(LOG_PREFIX, msg, options);
    return new Promise((resolve, reject) => {
      _getCastClient().then((client) => {
        client.launch(castv2.DefaultMediaReceiver, (err, player) => {
          if (err) {
            log.error(LOG_PREFIX, 'Connect error', err);
            client.close();
            reject(err);
            return;
          }

          player.on('status', (status) => {
            log.verbose(LOG_PREFIX, 'Player status', status);
            _self.emit('player_status', status);
            if (status && status.idleReason === 'FINISHED') {
              player.close();
              client.close();
              resolve(status);
            }
          });

          const media = {
            contentId: url,
            contentType: options.contentType || 'audio/mp3',
            streamType: options.streamType || 'BUFFERED',
          };
          if (options.duration) {
            media.duration = options.duration;
          }
          if (options.metadata) {
            media.metadata = options.metadata;
          }
          // if (options.volume) {
          //   media.volume = options.volume;
          // }

          player.load(media, {autoplay: true}, (err, status) => {
            if (err) {
              log.error(LOG_PREFIX, 'Player load error', err);
              player.close();
              client.close();
              reject(err);
              return;
            }
            log.verbose(LOG_PREFIX, 'Player load', status);
            _self.emit('player_loaded', status);
          });
        });
      });
    });
  };

  /**
   * Make an HTTP request to the local Google Home API.
   *
   * @param {String} method the HTTP method to use
   * @param {String} requestPath the URL/request path to hit
   * @param {Object} [body] The body to send along with the request
   * @return {Promise} A promise that resolves with the response
   */
  function _makeRequest(method, requestPath, body) {
    return new Promise((resolve, reject) => {
      const requestOptions = {
        uri: `http://${ipAddress}:8008${requestPath}`,
        method: method,
        json: true,
        agent: false,
      };
      if (body) {
        requestOptions.body = body;
      }
      const msg = `makeRequest('${method}', '${requestPath}', body)`;
      log.verbose(LOG_PREFIX, msg, body);

      request(requestOptions, (error, response, respBody) => {
        if (error) {
          log.verbose(LOG_PREFIX, `${msg} Response error: request`, error);
          reject(error);
          return;
        }
        resolve(respBody);
      });
    });
  }

  /**
   * Hit's the local API to get the device info
   *
   * @return {Promise} Response body returned from HTTP request.
   */
  function _getDeviceInfo() {
    const msg = `deviceInfo()`;
    log.debug(LOG_PREFIX, msg);

    const params = [
      'audio', 'build_info', 'detail', 'device_info', 'multizone', 'name',
      'net', 'night_mode_params', 'opencast', 'opt_in', 'proxy',
      'room_equalizer', 'settings', 'setup', 'user_eq', 'version', 'wifi',
    ];
    const details = `options=detail`;
    const url = `/setup/eureka_info?params=${params.join(',')}&${details}`;
    return _makeRequest('GET', url)
        .catch((err) => {})
        .then((data) => {
          if (!data) {
            return null;
          }
          if (diff(_self.deviceInfo, data)) {
            _self.deviceInfo = data;
            _self.emit('device_info_changed', data);
            _ready = true;
          }
          return data;
        });
  }

  /**
   * Hit's the local API to get the latest settings
   *
   * @return {Promise} Response body returned from HTTP request.
   */
  this.getDeviceInfo = function() {
    const msg = `getDeviceInfo()`;
    if (!_isReady()) {
      log.error(LOG_PREFIX, `${msg} failed, not ready.`);
      return Promise.reject(new Error('not_ready'));
    }
    log.debug(LOG_PREFIX, msg);
    return _getDeviceInfo();
  };

  /**
   * Hit's the local API to enable night mode
   *
   * @param {boolean} isNight
   * @return {Promise} Response body returned from HTTP request.
   */
  this.setNightMode = function(isNight) {
    const msg = `setNightMode(${isNight})`;
    if (!_isReady()) {
      log.error(LOG_PREFIX, `${msg} failed, not ready.`);
      return Promise.reject(new Error('not_ready'));
    }
    log.debug(LOG_PREFIX, msg);
    const url = '/setup/assistant/set_night_mode_params';
    const body = {
      enabled: isNight,
      do_not_disturb: isNight,
    };
    return _makeRequest('POST', url, body);
  };

  /**
   * Hit's the local API to enable/disable do not disturb
   *
   * @param {boolean} doNotDisturb
   * @return {Promise} Response body returned from HTTP request.
   */
  this.setDoNotDisturb = function(doNotDisturb) {
    const msg = `setDoNotDisturb(${doNotDisturb})`;
    if (!_isReady()) {
      log.error(LOG_PREFIX, `${msg} failed, not ready.`);
      return Promise.reject(new Error('not_ready'));
    }
    log.debug(LOG_PREFIX, msg);
    const url = '/setup/assistant/notifications';
    const body = {
      notifications_enabled: !doNotDisturb,
    };
    return _makeRequest('POST', url, body);
  };

  /**
   * Hit's the local API to get the do not disturb state.
   *
   * @return {Promise} Response body returned from HTTP request.
   */
  this.getDoNotDisturb = function() {
    const msg = `getDoNotDisturb()`;
    if (!_isReady()) {
      log.error(LOG_PREFIX, `${msg} failed, not ready.`);
      return Promise.reject(new Error('not_ready'));
    }
    log.debug(LOG_PREFIX, msg);
    const url = '/setup/assistant/notifications';
    return _makeRequest('POST', url);
  };

  _init();
}

util.inherits(GoogleHome, EventEmitter);

module.exports = GoogleHome;
