'use strict';

var fs = require('fs');
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

function writeLog(logger, level, message, error) {
  var dt = Date.now();
  var dtPretty = moment(dt).format('YYYY-MM-DDTHH:mm:ss.SSS');
  var l = ('     ' + level).slice(-5);
  var m = message;
  if (typeof message === 'object') {
    m = JSON.stringify(message, null, 2);
  }
  if (_fb) {
    var fb = {
      date: dt,
      datePretty: dtPretty,
      level: level,
      message: message
    };
    if (error) {
      fb.error = error;
    }
    _fb.child('logs/' + _appName).push(fb);
  }
  var levelColor = colors.reset;
  if (level === 'ERROR' || level === 'EXCPT' || level === 'STOP') {
    levelColor = colors.red;
  } else if (level === 'WARN') {
    levelColor = colors.yellow;
  } else if (level === 'INFO') {
    levelColor = colors.blue;
  } else if (level === 'INIT' || level === 'START') {
    levelColor = colors.green;
  }
  logger(dtPretty, ' | ', levelColor(l), ' | ', m);
  var strLog = dtPretty + ' | ' + l + ' | ' + m;
  if (error) {
    console.dir(error);
    strLog += '\n  ' + error.toString();
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
    writeLog(console.log, 'START', gitHead.head);
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
exports.level = http;
exports.version = gitHead.head;
exports.setDebug = setDebug;
