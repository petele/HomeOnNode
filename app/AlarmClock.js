'use strict';

const util = require('util');
const log = require('./SystemLog2');
const schedule = require('node-schedule');
const EventEmitter = require('events').EventEmitter;

const LOG_PREFIX = 'ALARM_CLOCK';

/**
 * Alarm Clock API.
 * @constructor
 *
 * @fires AlarmClock#alarm
 * @fires AlarmClock#alarm_set
 * @param {Object} fbRef Firebase reference to alarms config
*/
function AlarmClock(fbRef) {
  const _self = this;
  const _fbRef = fbRef;
  const _alarms = {};

  const FB_REF_KEY = 'alarmClock';
  const RE_PARSE_TIME = /(\d{1,2}):(\d{2})\s?([a-z]*)/i;

  /**
   * Init
   */
  function _init() {
    log.init(LOG_PREFIX, 'Starting...', _fbRef.key());
    const fbRefKey = _fbRef.key();
    if (fbRefKey !== FB_REF_KEY) {
      const details = {
        actual: fbRefKey,
        expected: FB_REF_KEY,
      };
      log.error(LOG_PREFIX, 'Invalid Firebase reference passed', details);
      return;
    }

    _fbRef.on('child_added', (snapshot) => {
      const key = snapshot.key();
      const details = snapshot.val();
      log.debug(LOG_PREFIX, `addAlarm('${key}', {...})`, details);
      _alarms[key] = {
        details: details,
        job: null,
      };
      _scheduleJob(key);
    });

    _fbRef.on('child_removed', (snapshot) => {
      const key = snapshot.key();
      log.debug(LOG_PREFIX, `removeAlarm('${key}')`);
      _cancelJob(key);
      delete _alarms[key];
    });

    _fbRef.on('child_changed', (snapshot) => {
      const key = snapshot.key();
      const details = snapshot.val();
      log.debug(LOG_PREFIX, `updateAlarm('${key}', {...})`, details);
      _alarms[key].details = details;
      _scheduleJob(key);
    });
  }

  /**
   * Creates or updates an alarm job
   *
   * @param {string} key
   */
  function _scheduleJob(key) {
    const alarm = _alarms[key];
    if (alarm.job) {
      _cancelJob(key);
    }
    alarm.details.status = 'OK';
    if (alarm.details.enabled) {
      try {
        const rule = _parseTime(alarm.details);
        alarm.job = schedule.scheduleJob(rule, () => {
          _fireAlarm(key);
        });
      } catch (ex) {
        alarm.details.status = ex.message;
        alarm.details.enabled = false;
      }
    }
    _notify(key);
  }

  /**
   * Cancels existing alarm jobs
   *
   * @param {string} key
   */
  function _cancelJob(key) {
    log.verbose(LOG_PREFIX, `cancelJob('${key}')`);
    const alarm = _alarms[key];
    if (alarm && alarm.job) {
      alarm.job.cancel();
      alarm.job = null;
    }
  }

  /**
   * Parses the alarm time details & creates a recurring time rule
   *
   * @param {Object} details
   * @return {Object} schedule.RecurrenceRule()
   */
  function _parseTime(details) {
    const msg = `parseTime({...})`;

    const match = details.time.match(RE_PARSE_TIME);
    if (!match) {
      log.error(LOG_PREFIX, `${msg} - failed, unable to parse`, details);
      throw new Error('Unable to parse time');
    }
    let hour = parseInt(match[1], 10);
    const minute = parseInt(match[2], 10);
    const sAMPM = match[3].toLowerCase();
    if (sAMPM === 'am' && hour === 12) {
      hour = 0;
    } else if (sAMPM === 'pm' && hour < 12) {
      hour += 12;
    }

    if (hour < 0 || hour > 23 || minute < 0 || minute > 59) {
      log.error(LOG_PREFIX, `${msg} - failed, invalid time`, details);
      throw new Error('Invalid time');
    }
    if (details.repeat && details.repeat.length !== 7) {
      log.error(LOG_PREFIX, `${msg} - failed, invalid repeat`, details);
      throw new Error('Unable to parse repeat');
    }

    const rule = new schedule.RecurrenceRule();
    rule.hour = hour;
    rule.minute = minute;

    if (details.repeat) {
      const dayOfWeek = [];
      details.repeat.split('').forEach((char, index) => {
        if (char.toLowerCase() === 'x') {
          dayOfWeek.push(index);
        }
      });
      rule.dayOfWeek = dayOfWeek;
    }
    return rule;
  }

  /**
   * Helper called when an alarm is triggered
   *
   * @param {string} key
   */
  function _fireAlarm(key) {
    const alarm = _alarms[key];
    const details = alarm.details;
    log.verbose(LOG_PREFIX, `alarm ${key}`, details);
    _self.emit('alarm', key, details);
    if (!details.repeat) {
      details.enabled = false;
      _cancelJob(key);
    }
    _notify(key);
  }

  /**
   * Helper called when an alarm is created, updated, or the next one
   * is scheduled.
   *
   * @param {string} key
   */
  function _notify(key) {
    const alarm = _alarms[key];
    let nextInvocation = null;
    if (alarm.job) {
      nextInvocation = alarm.job.nextInvocation();
      nextInvocation = log.formatTime(nextInvocation._date, true);
    }
    alarm.details.nextInvocation = nextInvocation;
    log.verbose(LOG_PREFIX, `_notify('${key}')`, alarm.details);
    _self.emit('alarm_set', key, alarm.details);
  }

  _init();
}

util.inherits(AlarmClock, EventEmitter);

module.exports = AlarmClock;
