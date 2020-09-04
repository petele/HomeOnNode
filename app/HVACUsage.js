'use strict';

/* node14_ready */

const util = require('util');
const moment = require('moment');
const log = require('./SystemLog2');
const FBHelper = require('./FBHelper');
const CronJob = require('cron').CronJob;
const EventEmitter = require('events').EventEmitter;

const LOG_PREFIX = 'HVAC_Usage';

/**
 * HVACUsage API.
 * @constructor
 *
 * @param {Boolean} [manual] Don't auto-generate reports
 */
function HVACUsage(manual) {
  const _self = this;

  /**
   * Init
  */
  function _init() {
    if (manual === true) {
      log.init(LOG_PREFIX, `Starting in 'manual' mode...`);
      return;
    }

    log.init(LOG_PREFIX, `Starting in 'auto' mode...`);

    // Run every night, at 15 seconds past midnight.
    const cronSchedule = '15 00 00 * * *';
    new CronJob(cronSchedule, () => {
      const yesterday = moment().subtract(1, 'days').format('YYYY-MM-DD');
      _self.generateSummaryForDay(yesterday)
          .then(() => {
            _self.generateSummaryForDay();
          });
    }, null, true, 'America/New_York');
  }

  this.generateSummaryForDay = async function(day) {
    if (!day) {
      day = moment().format('YYYY-MM-DD');
    }
    log.verbose(LOG_PREFIX, `Generating HVACUsage report for ${day}...`);
    try {
      const events = await _getEvents(day);
      const summary = _generateSummary(day, events);
      return await _saveSummary(day, summary);
    } catch (ex) {
      const msg = `Unable to generate/save summary for ${day}`;
      log.exception(LOG_PREFIX, msg, ex);
      return null;
    }
  };

  /**
   * Gets events from Firebase for the specified day.
   *
   * @param {String} day YYYY-MM-DD
   * @return {Promise} Resolves to data
   */
  async function _getEvents(day) {
    log.verbose(LOG_PREFIX, `Getting 'events' for ${day}`);
    const path = `logs/hvacUsage/events/${day}`;
    const fbRef = await FBHelper.getRef(path);
    const entriesSnap = await fbRef.once('value');
    const entries = entriesSnap.val();
    if (!entries) {
      const msg = `No events for ${day}.`;
      log.debug(LOG_PREFIX, msg);
    }
    return entries;
  }

  /**
   * Generates a summary object from the provided data.
   *
   * @param {String} day YYYY-MM-DD
   * @param {Array} events
   * @return {Object}
   */
  function _generateSummary(day, events) {
    log.verbose(LOG_PREFIX, `Building summary for ${day}`);

    const start = moment(day, 'YYYY-MM-DD').valueOf();
    const result = {
      start: start,
      runTime: {
        BR: 0,
        LR: 0,
      },
    };

    try {
      if (events && events.BR) {
        const dayDataBR = _parseDataForDay(start, events.BR);
        result.runTime.BR = _calculateRunTime(dayDataBR);
      }
    } catch (ex) {
      log.exception(LOG_PREFIX, `Unable to generate summary for BR`, ex);
    }

    try {
      if (events && events.LR) {
        const dayDataLR = _parseDataForDay(start, events.LR);
        result.runTime.LR = _calculateRunTime(dayDataLR);
      }
    } catch (ex) {
      log.exception(LOG_PREFIX, `Unable to generate summary for LR`, ex);
    }

    return result;
  }

  /**
   * Saves generated summary to Firebase
   *
   * @param {String} day - YYYY-MM-DD
   * @param {Object} summary - HVAC usage summary for specified day
   * @return {Promise}
   */
  async function _saveSummary(day, summary) {
    log.verbose(LOG_PREFIX, `Saving summary for ${day}`);
    const path = `logs/hvacUsage/summary/${day}`;
    const fbRef = await FBHelper.getRef(path);
    await fbRef.set(summary);
    log.debug(LOG_PREFIX, `Saved HVACUsage summary for ${day}`, summary);
    return {day, summary};
  }

  /**
   * Clean and parse data provided
   *
   * @param {Number} start Unix time at midnight for the day
   * @param {Object} entries List of entries to parse and clean
   * @return {Array}
   */
  function _parseDataForDay(start, entries) {
    if (!entries) {
      return [];
    }
    const results = [];
    const times = Object.keys(entries);
    times.forEach((time) => {
      const mode = entries[time];
      time = parseInt(time);
      results.push({time, mode});
    });

    // Make sure there's a start element at midnight.
    if (results[0].mode === 'off') {
      results.unshift({time: start, mode: 'running'});
    } else {
      results.unshift({time: start, mode: 'off'});
    }

    // Make sure there's an off event at the end of the day.
    if (results[results.length - 1].mode !== 'off') {
      const now = Date.now();
      let end = start + (24 * 60 * 60 * 1000);
      if (end > now) {
        end = now;
      }
      results.push({time: end, mode: 'off'});
    }

    return results;
  }

  /**
   * Iterate through all events and calculate the run time
   *
   * @param {Array} events
   * @return {Number} Number of minutes the HVAC unit was on.
   */
  function _calculateRunTime(events) {
    if (!events || events.length === 0) {
      return 0;
    }

    let runTime = 0;
    let startTime = null;
    let prevVal;
    events.forEach((event) => {
      if (prevVal === event.mode) {
        return;
      }
      prevVal = event.mode;
      if (event.mode === 'off' && startTime !== null) {
        const duration = event.time - startTime;
        runTime += duration;
        startTime = null;
        return;
      }
      startTime = event.time;
    });
    return Math.round(runTime / 1000 / 60);
  }

  _init();
}

util.inherits(HVACUsage, EventEmitter);

module.exports = HVACUsage;
