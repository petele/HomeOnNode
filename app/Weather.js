'use strict';

const util = require('util');
const request = require('request');
const log = require('./SystemLog2');
const EventEmitter = require('events').EventEmitter;

const LOG_PREFIX = 'WEATHER';

/**
 * Weather API.
 * @constructor
 *
 * @fires Weather#weather
 * @param {String} latLon Lat/Lon of the location to get weather for.
 * @param {String} key Forecast.io API Key.
*/
function Weather(latLon, key) {
  const REFRESH_INTERVAL = 5 * 60 * 1000;
  const _weatherURL = `https://api.forecast.io/forecast/${key}/${latLon}`;
  const _self = this;

  /**
   * Init
  */
  function _init() {
    log.init(LOG_PREFIX, 'Starting...', {latLon: latLon});
    _getWeather();
    setInterval(_getWeather, REFRESH_INTERVAL);
  }

  /**
   * Get's the latest weather.
   *  Fires an event (weather) when the weather has been updated.
  */
  function _getWeather() {
    request(_weatherURL, function(error, response, body) {
      const msg = 'Forecast.io request error';
      if (error) {
        log.error(LOG_PREFIX, msg, error);
        return;
      }
      if (!response) {
        log.error(LOG_PREFIX, msg + ': no response.');
        return;
      }
      if (response.statusCode !== 200) {
        log.error(LOG_PREFIX, msg + ': response code:' + response.statusCode);
        return;
      }
      try {
        const fullForecast = JSON.parse(body);
        const forecast = {
          now: fullForecast.currently,
          today: fullForecast.daily.data[0],
        };
        /**
         * Fires when the weather info has changed
         * @event Weather#weather
         */
        _self.emit('weather', forecast);
        log.verbose(LOG_PREFIX, 'Weather updated.', forecast);
        return;
      } catch (ex) {
        log.exception(LOG_PREFIX, 'Unable to parse forecast.io response', ex);
        return;
      }
    });
  }

  _init();
}

util.inherits(Weather, EventEmitter);

module.exports = Weather;
