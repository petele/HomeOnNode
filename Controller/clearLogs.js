'use strict';

var Keys = require('./Keys');
var Firebase = require('firebase');

var fb;
var numRunning = 0;

function init() {
  fb = new Firebase('https://boiling-torch-4633.firebaseio.com/');
  fb.auth(Keys.keys.fb, function(error) {
    if(error) {

    } else {
      cleanLogs('logs/app', 30);
      cleanLogs('logs/door', 120);
      cleanLogs('logs/door-closet', 30);
      cleanLogs('logs/door', 7);
      cleanLogs('logs/presence', 365);
      cleanLogs('logs/system_state', 120);
      cleanLogs('logs/temperature/inside', 90);
    }
  });
}

function cleanLogs(path, maxAgeDays) {
  numRunning++;
  var now = Date.now();
  console.log('Cleaning path', path);
  fb.child(path).once('value', function(snapshot) {
    var maxAgeMilli = 60 * 60 * 24 * maxAgeDays * 1000;
    var countTotal = 0;
    var countRemoved = 0;
    snapshot.forEach(function(childSnapshot) {
      countTotal++;
      var age = now - childSnapshot.val().date;
      if (age > maxAgeMilli) {
        countRemoved++;
        console.log('Removed', path, childSnapshot.val());
        childSnapshot.ref().remove();
      }
    });
    console.log('Cleaned', path, ' checked ', countTotal, ' removed ', countRemoved);
    numRunning--;
    exitWhenDone();
  });
}

function exitWhenDone() {
  if (numRunning === 0) {
    console.log('Done');
    process.exit(0);
  }
}

init();
