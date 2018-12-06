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
*/
function AlarmClock(fbRef) {
  const _self = this;
  const _fbRef = fbRef;
  const _alarms = {};

  /**
   * Init
   */
  function _init() {
    log.init(LOG_PREFIX, 'Starting...');

    _fbRef.on('child_added', (snapshot) => {
      const key = snapshot.key();
      const alarm = snapshot.val();
      _addAlarm(key, alarm);
    });
    _fbRef.on('child_removed', (snapshot) => {
      const key = snapshot.key();
      _removeAlarm(key);
    });
    _fbRef.on('child_changed', (snapshot) => {
      const key = snapshot.key();
      const alarm = snapshot.val();
      _updateAlarm(key, alarm);
    });
  }

  /**
   * Adds an alarm
   */
  function _addAlarm(key, alarmInfo) {
    log.debug(LOG_PREFIX, `addAlarm(${key}, ...)`, alarm);
    if (!alarmInfo.enabled) {
      return;
    }
    const alarm = schedule.scheduleJob(alarmInfo.when, (e) => {
      log.debug(LOG_PREFIX, `Alarm ${key} Fired`, alarmInfo);
      _self.emit('alarm', key, alarmInfo);
    });
    _alarms[key] = alarm;
  }

  /**
   * Remove an alarm
   */
  function _removeAlarm(key) {
    log.debug(LOG_PREFIX, `removeAlarm(${key})`);
    const alarm = _alarms[key];
    if (!alarm) {
      return;
    }
    alarm.cancel();
    delete _alarms[key];
  }

  /**
   * Update an alarm
   */
  function _updateAlarm(key, alarm) {
    log.debug(LOG_PREFIX, `updateAlarm(${key}, ...)`, alarm);

    _alarms[key] = alarm;
  }

  _init();
}

util.inherits(AlarmClock, EventEmitter);

module.exports = AlarmClock;
