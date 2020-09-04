'use strict';

/* node14_ready */

const util = require('util');
const log = require('./SystemLog2');
const fetch = require('node-fetch');
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
  async function _getWeather() {
    let weatherForecast;
    try {
      const resp = await fetch(_weatherURL);
      if (!resp.ok) {
        log.exception(LOG_PREFIX, 'Invalid server response', resp);
        return;
      }
      weatherForecast = await resp.json();
    } catch (ex) {
      log.exception(LOG_PREFIX, 'An error occured getting forecast.', ex);
      return;
    }
    const forecast = {
      now: weatherForecast.currently,
      hourly: weatherForecast.hourly,
      today: weatherForecast.daily.data[0],
      tomorrow: weatherForecast.daily.data[1],
    };
    log.verbose(LOG_PREFIX, 'Weather updated.', forecast);
    _self.emit('weather', forecast);
    return;
  }

  _init();
}

util.inherits(Weather, EventEmitter);

module.exports = Weather;
