'use strict';

var Keys = require('../app/Keys').keys;
var Firebase = require('../app/node_modules/firebase');
var moment = require('../app/node_modules/moment');
var log = require('../app/SystemLog2');

var DATE_FORMAT = 'YYYY-MM-DDTHH:mm:ss.SSS';
var LOG_PREFIX = 'ALARM_CLOCK';
var alarmList = {};

function alarmUpdated(alarm) {
  var key = alarm.key();
  alarmList[key] = alarm.val();
  var msg = 'alarmUpdated [' + key + '] for ' + alarmList[key].time;
  log.log(LOG_PREFIX, msg);
}
function alarmRemoved(alarm) {
  var key = alarm.key();
  delete alarmList[key];
  log.log(LOG_PREFIX, 'alarmRemoved' + key);
}

function fireAlarm(key, alarm) {
  var now = moment();
  alarm.lastFired = now.format(DATE_FORMAT);
  alarm.timesFired += 1;
  var msg = 'alarmFired [' + key + '] off by ';
  msg += now.diff(moment(alarm.time)) + 'ms';
  log.log(LOG_PREFIX, msg, alarm);
  fb.child('config/alarms/' + key).set(alarm);
}

function getNextAlarmTime(key, alarm) {
  var momentNow = moment();
  var momentAlarm;
  var strAlarmTime = alarm.time;
  if (strAlarmTime[0] === 'R') {
    var dayOfWeek = momentNow.day() + 1;
    if (strAlarmTime[dayOfWeek] !== '1') {
      return false;
    }
    strAlarmTime = 'T' + strAlarmTime.substring(1);
  }

  if (strAlarmTime[0] === 'T') {
    var strDate = momentNow.format('YYYY-MM-DD');
    strAlarmTime = strDate + alarm.time.substr(strAlarmTime.indexOf('T'));
  }
  momentAlarm = moment(strAlarmTime);
  if (momentAlarm.isValid()) {
    return momentAlarm;
  }
  return null;
}

function testAlarmTime(key, alarm) {
  var momentNow = moment();
  var momentAlarm;
  var strAlarmTime = alarm.time;
  if (strAlarmTime[0] === 'R') {
    var dayOfWeek = momentNow.day() + 1;
    if (strAlarmTime[dayOfWeek] !== '1') {
      return false;
    }
    strAlarmTime = 'T' + strAlarmTime.substring(1);
  }

  if (strAlarmTime[0] === 'T') {
    var strDate = momentNow.format('YYYY-MM-DD');
    strAlarmTime = strDate + alarm.time.substr(strAlarmTime.indexOf('T'));
  }
  momentAlarm = moment(strAlarmTime);

  if (momentAlarm.isValid() === false) {
    return false;
  }

  // Bails if the lastFired is the same/after the scheduled Alarm
  if (alarm.lastFired) {
    var momentLastFired = moment(alarm.lastFired);
    if (momentLastFired.isSameOrAfter(momentAlarm)) {
      return false;
    }
  }

  // Bails if the scheduled Alarm should have fired 5+ minutes ago.
  if (momentAlarm.diff(momentNow, 'minutes') <= -5) {
    return false;
  }

  if (momentNow.isSameOrAfter(momentAlarm, 'second')) {
    return true;
  }

  return false;
}

function alarmTick(key) {
  var alarm = alarmList[key];
  if (alarm.enabled !== true) {
    return false;
  }
  if (testAlarmTime(key, alarm) === true) {
    fireAlarm(key, alarm);
    return true;
  }
  return false;
}

function timerTick() {
  var keys = Object.keys(alarmList);
  keys.forEach(alarmTick);
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
    time: timeForAlarm.format('THH:mm:ss.SSS'),
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
