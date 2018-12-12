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
    if (_ready) {
      return true;
    }
    log.warn(LOG_PREFIX, `Google Home API not ready.`);
    return false;
  }

  /**
   * Makes the Google Home say the specific utterance.
   *
   * @param {string} utterance The utterance the Google Home should say.
   * @return {Promise}
   */
  this.say = function(utterance) {
    const msg = `say('${utterance}')`;
    log.debug(LOG_PREFIX, msg);
    if (!_isReady()) {
      return;
    }
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
   * @param {number} level Volume level (0-100).
   * @return {number}
   */
  this.setVolume = function(level) {
    const msg = `setVolume(${level})`;
    log.debug(LOG_PREFIX, msg);
    if (!_isReady()) {
      return;
    }
    if (level > 100 || level < 0) {
      log.error(LOG_PREFIX, `${msg} failed, level out of bounds.`);
      return;
    }
    return _getCastClient().then((client) => {
      client.setVolume({level: level / 100}, (err, resp) => {
        client.close();
        if (err) {
          log.error(LOG_PREFIX, 'Unable to set volume', err);
          return level;
        }
      });
    });
  };


  /**
   * Makes the Google Home play the specific URL.
   *
   * @param {string} url A sound URL to play.
   * @param {string} [contentType] default: 'audio/mp3'.
   * @return {Promise}
   */
  this.play = function(url, contentType) {
    const msg = `play('${url}', contentType)`;
    log.debug(LOG_PREFIX, msg, contentType);
    if (!_isReady()) {
      return;
    }
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
            if (status && status.idleReason === 'FINISHED') {
              player.close();
              client.close();
              resolve(status);
            }
          });

          const media = {
            contentId: url,
            contentType: contentType || 'audio/mp3',
            streamType: 'BUFFERED',
          };

          player.load(media, {autoplay: true}, (err, status) => {
            if (err) {
              log.error(LOG_PREFIX, 'Play error', err);
              player.close();
              client.close();
              reject(err);
              return;
            }
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
      log.verbose(LOG_PREFIX, msg, requestOptions);

      request(requestOptions, (error, response, respBody) => {
        if (error) {
          log.verbose(LOG_PREFIX, `${msg} Response error: request`, error);
          reject(error);
          return;
        }
        // const statusCode = response.statusCode;
        // log.verbose(LOG_PREFIX, `${msg} completed. (${statusCode}).`, respBody);
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
    log.verbose(LOG_PREFIX, msg);

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
    log.verbose(LOG_PREFIX, msg);

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
    log.verbose(LOG_PREFIX, msg);

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
    log.verbose(LOG_PREFIX, msg);

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
    log.verbose(LOG_PREFIX, msg);

    const url = '/setup/assistant/notifications';
    return _makeRequest('POST', url);
  };

  _init();
}

util.inherits(GoogleHome, EventEmitter);

module.exports = GoogleHome;
