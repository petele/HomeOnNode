'use strict';

var fs = require('fs');
var util = require('util');
var colors = require('colors');
var gitHead = require('./version');
var moment = require('moment');

var _appName = 'NOT_SET';
var _logFile = null;
var _fbRef = null;
var _logToConsole = true;
var _logDebug = false;

function generateLog(level, message, error) {
  var dt = Date.now();
  var dtPretty = moment(dt).format('YYYY-MM-DDTHH:mm:ss.SSS');
  var logObj = {
    appName: _appName,
    date: dt,
    date_: dtPretty,
    level: level,
    message: message,
    gitHead: gitHead.head
  };
  if (error) {
    logObj.error = error;
  }
  return logObj;
}

function printLogObj(logObj) {
  var level = logObj.level;
  var formattedLevel = ('     ' + level).slice(-5);
  var levelColor = colors.reset;
  var fullColor = false;
  if (level === 'ERROR' || level === 'EXCPT' || level === 'STOP') {
    levelColor = colors.red;
    fullColor = true;
  } else if (level === 'WARN') {
    levelColor = colors.yellow;
    fullColor = true;
  } else if (level === 'INFO') {
    levelColor = colors.blue;
  } else if (level === 'INIT' || level === 'START') {
    levelColor = colors.green;
  } else if (level === 'TODO') {
    levelColor = colors.cyan;
  }
  var strLine = logObj.date_ + ' | ' + levelColor(formattedLevel) + ' | ';
  if (fullColor === true) {
    strLine += levelColor(logObj.message);
  } else {
    strLine += logObj.message;
  }
  console.log(strLine);
  if (logObj.error) {
    strLine = util.inspect(logObj.error, {showHidden: true, colors: true});
    console.log('EXCEPTION: ', strLine);
  }
}

function saveLog(logObj) {
  if (_logToConsole === true) {
    printLogObj(logObj);
  }
  if (_fbRef) {
    try {
      _fbRef.child('logs/logs').push(logObj);
    } catch (ex) {
      _fbRef = null;
      var message = '[LOGGER] Unable to write log to Firebase.';
      saveLog(generateLog('ERROR', message, ex));
    }
  }
  if (_logFile) {
    var formattedLevel = ('     ' + logObj.level).slice(-5);
    var strLog = logObj.date_ + ' | ' + formattedLevel + ' | ';
    strLog += logObj.message;
    if (logObj.error) {
      strLog += '\n' + 'EXCEPTION: ';
      strLog += util.inspect(logObj.error, {showHidden: true, colors: false});
    }
    try {
      fs.appendFile(_logFile, strLog + '\n');
    } catch (ex) {
      _logFile = null;
      var message = '[LOGGER] Unable to write log file.';
      saveLog(generateLog('ERROR', message, ex));
    }
  }
}

function log(message) {
  saveLog(generateLog('INFO', message));
}

function warn(message) {
  saveLog(generateLog('WARN', message));
}

function error(message) {
  saveLog(generateLog('ERROR', message));
}

function exception(message, ex) {
  saveLog(generateLog('EXCPT', message, ex));
}

function debug(message) {
  if (_logDebug === true) {
    saveLog(generateLog('DEBUG', message));
  }
}

function todo(message) {
  saveLog(generateLog('TODO', message));
}

function init(message) {
  saveLog(generateLog('INIT', message));
}

function http(method, message) {
  saveLog(generateLog(method.toUpperCase(), message));
}

function appStart(appName) {
  if (appName) {
    _appName = appName;
    var message = appName + ' (' + gitHead.head + ')';
    saveLog(generateLog('START', message));
  } else {
    throw new Error('No appName provided');
  }
}

function appStop(receivedFrom) {
  if (!receivedFrom) {
    receivedFrom = 'UNKNOWN';
  }
  var message = 'Received from: ' + receivedFrom;
  saveLog(generateLog('STOP', message));
}

exports.logToFile = _logFile;
exports.logToFBRef = _fbRef;
exports.logToConsole = _logToConsole;
exports.debug = _logDebug;
exports.printLogObj = printLogObj;
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
