'use strict';

var Keys = require('../app/Keys').keys;
var Firebase = require('../app/node_modules/firebase');
var log = require('../app/SystemLog2');

// {name: 'Weekday Morning Recurring', scheduledFor: 'R0111110T09:30', lastFired: 0, timesFired: 0, enabled: true},
// {name: 'Weekday Afternoon Recurring', scheduledFor: 'R0111110T14:48', lastFired: 0, timesFired: 0, enabled: true},
// {name: 'Daily Morning', scheduledFor: 'T09:48', lastFired: 0, timesFired: 0, enabled: true},
// {name: 'Daily Afternoon', scheduledFor: 'T15:48', lastFired: 0, timesFired: 0, enabled: true},


var myAlarms = [
{name: 'Daily Morning', scheduledFor: 'T09:48', lastFired: 0, timesFired: 0, enabled: true},
{name: 'Daily Afternoon', scheduledFor: 'T18:48', lastFired: 0, timesFired: 0, enabled: true},
{name: 'Disabled Daily Afternoon', scheduledFor: 'T16:48', lastFired: 0, timesFired: 0, enabled: false},

{name: 'OneTimeA', scheduledFor: '2016-08-02T10:28:00', lastFired: 0, timesFired: 0, enabled: true},
{name: 'OneTimeB', scheduledFor: '2016-08-01T15:37:00', lastFired: 0, timesFired: 0, enabled: true},

{name: 'Weekday Morning Recurring', scheduledFor: 'R0111110T09:30', lastFired: 0, timesFired: 0, enabled: true},
{name: 'Weekday Afternoon Recurring', scheduledFor: 'R0111110T14:48', lastFired: 0, timesFired: 0, enabled: true},
{name: 'Weekend Morning Recurring', scheduledFor: 'R1000001T14:48', lastFired: 0, timesFired: 0, enabled: true},
{name: 'DisabledWeekend Morning Recurring', scheduledFor: 'R1000001T14:48', lastFired: 0, timesFired: 0, enabled: false},
];

function addAlarms(alarms) {
  alarms.forEach(function(alarm) {
    var a = fb.child('config/alarms').push(alarm);
    console.log('Added:',a.key(), alarm);
  });
}

var fbURL = 'https://' + Keys.firebase.appId + '.firebaseio.com/';
var fb = new Firebase(fbURL);
fb.authWithCustomToken(Keys.firebase.key, function(error, authToken) {
  if (error) {
    log.exception('ADD Alarms', 'Firebase auth failed.', error);
  } else {
    log.log('ADD Alarms', 'Firebase auth success.');
    addAlarms(myAlarms);
  }
});
