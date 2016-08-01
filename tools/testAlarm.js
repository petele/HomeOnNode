'use strict';

var Keys = require('../app/Keys').keys;
var Firebase = require('../app/node_modules/firebase');
var moment = require('../app/node_modules/moment');
var log = require('../app/SystemLog2');

var DATE_FORMAT = 'YYYY-MM-DDTHH:mm:ss';
var LOG_PREFIX = 'ALARM_CLOCK';
var alarmList = {};

function updateAlarmEntry(key, alarm) {
  var msg = 'updateEntry ' + alarm.name + ': ';
  if (alarm.enabled === false) {
    if (alarmList[key]) {
      delete alarmList[key];
    }
    log.log(LOG_PREFIX, msg + ' DISABLED');
    return;
  }
  var nextAlarm = getNextAlarm(alarm.scheduledFor);
  if (nextAlarm.isValid === false) {
    msg += 'INVALID';
    log.error(LOG_PREFIX, msg, nextAlarm.creationData());
    return;
  }
  if (nextAlarm.isBefore(moment())) {
    msg += 'DISABLED (In the past: ' + nextAlarm.format(DATE_FORMAT) + ')';
    log.warn(LOG_PREFIX, msg);
    return;
  }
  alarm.scheduledAt = nextAlarm;
  alarmList[key] = alarm;
  log.log(LOG_PREFIX, msg + 'Set for ' + nextAlarm.format(DATE_FORMAT));
}

function alarmUpdated(fbAlarm) {
  var key = fbAlarm.key();
  var alarm = fbAlarm.val();
  // var msg = 'alarmUpdated (' + key + ')';
  // log.debug(LOG_PREFIX, msg);
  updateAlarmEntry(key, alarm);
}

function alarmRemoved(alarm) {
  var key = alarm.key();
  delete alarmList[key];
  log.log(LOG_PREFIX, 'alarmRemoved' + key);
}

function getNextAlarm(scheduledFor) {
  var now = moment();
  var result;

  if (scheduledFor[0] === 'R') {
    var today = now.day();
    var scheduledDays = scheduledFor.substring(1, 8);
    if (scheduledDays === '0000000') {
      return moment.invalid();
    }
    var timeScheduledFor = scheduledFor.substring(scheduledFor.indexOf('T'));
    result = moment(timeScheduledFor, ['THH:mm', 'THH:mm:ss']);
    if (result.isBefore(now) || scheduledDays[today] === '0') {
      for (var i = 1; i <= 7; i++) {
        var pointer = (today + i) % 7;
        if (scheduledDays[pointer] === '1') {
          result.add(today + i - 1, 'days');
          break;
        }
      }
    }
  }

  if (scheduledFor[0] === 'T') {
    result = moment(scheduledFor, ['THH:mm', 'THH:mm:ss']);
    if (result.isBefore(now)) {
      result = result.add(1, 'day');
    }
  }

  if (!result) {
    result = moment(scheduledFor, 'YYYY-MM-DDTHH:mm:ss');
  }
  return result;
}

function testAlarm(key) {
  var now = moment();
  var msg = 'testAlarm [' + key + '] ';
  var alarm = alarmList[key];
  if (!alarm) {
    log.warn(LOG_PREFIX, msg + 'KEY not found.');
    return false;
  }
  // Bails if the lastFired is the same/after the scheduled Alarm
  if (alarm.lastFired) {
    var momentLastFired = moment(alarm.lastFired);
    if (momentLastFired.isSameOrAfter(alarm.scheduledAt)) {
      return false;
    }
  }
  // Bails if the scheduled Alarm should have fired 5+ minutes ago.
  if (alarm.scheduledAt.diff(now, 'minutes') <= -5) {
    return false;
  }
  if (now.isSameOrAfter(alarm.scheduledAt, 'second')) {
    fireAlarm(key, alarm);
    return true;
  }

  return false;
}

function fireAlarm(key, alarm) {
  var now = moment();
  var msg = alarm.name + '[' + key + '] fired at ';
  msg += now.format(DATE_FORMAT);
  msg += ' ' + alarm.scheduledFor;
  log.log(LOG_PREFIX, msg);
  var stats = {
    lastFired: now.format(DATE_FORMAT),
    timesFired: alarm.timesFired + 1
  };
  fb.child('config/alarms/' + key).update(stats);
}

function timerTick() {
  var keys = Object.keys(alarmList);
  keys.forEach(testAlarm);
  setTimeout(timerTick, 250);
}

var fbURL = 'https://' + Keys.firebase.appId + '.firebaseio.com/';
var fb = new Firebase(fbURL);
fb.authWithCustomToken(Keys.firebase.key, function(error, authToken) {
  if (error) {
    log.exception(LOG_PREFIX, 'Firebase Auth failed', error);
  } else {
    log.log(LOG_PREFIX, 'Firebase auth success.');
    fb.child('config/alarms').on('child_changed', alarmUpdated);
    fb.child('config/alarms').on('child_added', alarmUpdated);
    fb.child('config/alarms').on('child_removed', alarmRemoved);
    addRandomAlarm('now');
  }
});

timerTick();

var i = 0;

function addRandomAlarm(when) {
  var min = 5;
  var max = 25;
  if (when === 'now') {
    min = 1;
    max = 1;
  }
  var randomMinute = Math.floor(Math.random() * (max - min + 1) + min);
  var timeForAlarm = moment().add(randomMinute, 'minutes');
  timeForAlarm = timeForAlarm.milliseconds(0);
  var randAlarm = {
    name: 'Random Alarm: ' + i.toString(),
    scheduledFor: timeForAlarm.format('THH:mm:ss.SSS'),
    lastFired: 0,
    timesFired: 0,
    enabled: true
  };
  var msg = 'AddRandomAlarm for: ' + timeForAlarm.format(DATE_FORMAT);
  log.log(LOG_PREFIX, msg);
  fb.child('config/alarms').push(randAlarm);
  i++;
  setTimeout(addRandomAlarm, 30 * 60 * 1000);
}
