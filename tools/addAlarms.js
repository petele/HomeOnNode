'use strict';

var Keys = require('../app/Keys').keys;
var Firebase = require('../app/node_modules/firebase');
var log = require('../app/SystemLog2');

var myAlarms = [
{name: 'Weekday Morning', time: 'R0111110T09:30:00', lastFired: 0, timesFired: 0, enabled: true},
{name: 'OneTime A', time: '2016-08-01T10:28:00.000', lastFired: 0, timesFired: 0, enabled: true},
{name: 'OneTime B', time: '2016-08-01T10:37:00.000', lastFired: 0, timesFired: 0, enabled: true},
{name: 'Afternoon Morning', time: 'R0111110T14:48:20', lastFired: 0, timesFired: 0, enabled: true},
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
