'use strict';

var fs = require('fs');
var util = require('util');
var colors = require('colors');
var gitHead = require('./version');
var moment = require('moment');

var DEBUG = false;
var LOG_FILE = './logs/rpi-system.log';

var _fb;
var _appName;

function setFirebase(fbRef) {
  _fb = fbRef;
}

function setDebug(isDebug) {
  DEBUG = isDebug;
}

function writeLog(logger, level, message, ex) {
  var dt = Date.now();
  var dtPretty = moment(dt).format('YYYY-MM-DDTHH:mm:ss.SSS');
  var l = ('     ' + level).slice(-5);
  var m = message;
  if (typeof message === 'object') {
    m = JSON.stringify(message, null, 2);
  }
  if (_fb) {
    var fb = {
      appName: _appName,
      date: dt,
      date_: dtPretty,
      level: level,
      message: message
    };
    if (ex) {
      fb.ex = JSON.stringify(ex);
    }
    _fb.child('logs/logs').push(fb);
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
  logger(line);
  var strLog = dtPretty + ' | ' + l + ' | ' + m;
  if (ex) {
    console.log(util.inspect(ex, {showHidden: true, colors: true}));
    strLog += '\n' + util.inspect(ex, {showHidden: true});
  }
  fs.appendFile(LOG_FILE, strLog + '\n');
}

function log(message) {
  writeLog(console.log, 'INFO', message);
}

function warn(message) {
  writeLog(console.warn, 'WARN', message);
}

function error(message) {
  writeLog(console.error, 'ERROR', message);
}

function exception(message, ex) {
  writeLog(console.error, 'EXCPT', message, ex);
}

function debug(message) {
  if (DEBUG) {
    writeLog(console.log, 'DEBUG', message);
  }
}

function todo(message) {
  writeLog(console.log, 'TODO', message);
}

function init(message) {
  writeLog(console.log, 'INIT', message);
}

function http(method, message) {
  writeLog(console.log, method.toUpperCase(), message);
}

function appStart(appName, debug) {
  if (appName) {
    _appName = appName;
    DEBUG = debug === true ? true : false;
    writeLog(console.log, 'START', appName + ' (' + gitHead.head + ')');
  } else {
    throw new Error('No appName provided');
  }
}

function appStop(receivedFrom) {
  if (!receivedFrom) {
    receivedFrom = 'UNKNOWN';
  }
  writeLog(console.log, 'STOP', 'Received from: ' + receivedFrom);
}

exports.setFirebase = setFirebase;
exports.log = log;
exports.error = error;
exports.exception = exception;
exports.debug = debug;
exports.warn = warn;
exports.appStart = appStart;
exports.appStop = appStop;
exports.init = init;
exports.http = http;
exports.todo = todo;
exports.level = http;
exports.version = gitHead.head;
exports.setDebug = setDebug;
