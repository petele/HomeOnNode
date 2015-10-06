'use strict';

var Keys = require('./Keys').keys;
var Firebase = require('firebase');
var log = require('./SystemLog');
var moment = require('moment');
var util = require('util');
var colors = require('colors');


function writeLog(level, dt, message, ex) {
  var dtPretty = moment(dt).format('YYYY-MM-DDTHH:mm:ss.SSS');
  var l = ('     ' + level).slice(-5);
  var m = message;
  if (typeof message === 'object') {
    m = JSON.stringify(message, null, 2);
  }
  var levelColor = colors.reset;
  var wholeLine = false;
  if (level === 'ERROR' || level === 'EXCPT' || level === 'STOP') {
    levelColor = colors.red;
    wholeLine = true;
  } else if (level === 'WARN') {
    levelColor = colors.yellow;
    wholeLine = true;
  } else if (level === 'INFO') {
    levelColor = colors.blue;
  } else if (level === 'INIT' || level === 'START') {
    levelColor = colors.green;
    wholeLine = true;
  } else if (level === 'TODO') {
    levelColor = colors.cyan;
    wholeLine = true;
  }
  var line = dtPretty + ' | ' + levelColor(l) + ' | ';
  if (wholeLine === true) {
    line += levelColor(m);
  } else {
    line += m;
  }
  console.log(line);
  if (ex) {
    console.log(util.inspect(ex, {showHidden: true, colors: true}));
  }
}


function printLogs(path) {
  fb.child(path).orderByChild('date').once('value',
    function(snapshot) {
      var itemsRemoved = 0;
      snapshot.forEach(function(item) {
        var msg = item.val();
        writeLog(msg.level, msg.date, msg.message, msg.ex);
      });
      process.exit(0);
    }
  );
}


//Keys.firebase.appId, Keys.firebase.key
var fbURL = 'https://' + Keys.firebase.appId + '.firebaseio.com/';
var fb = new Firebase(fbURL);
fb.authWithCustomToken(Keys.firebase.key, function(error, authToken) {
  if (error) {
    log.exception('[FIREBASE] Auth failed.', error);
  } else {
    log.log('[FIREBASE] Auth success.');
    printLogs('logs/logs');
  }
});


