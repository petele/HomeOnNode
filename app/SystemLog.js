'use strict';

var fs = require('fs');
var util = require('util');
var colors = require('colors');
var gitHead = require('./version');
var moment = require('moment');

var _appName = 'NOT_SET';
var _logToFile = false;
var _logFileDefault = './logs/rpi-system.log';
var _logFile = _logFileDefault;
var _fbRef = null;
var _logDebug = false;
var _verbose = true;

function setFirebase(fbRef) {
  if (fbRef) {
    _fbRef = fbRef;
    log('[LOGGER] Firebase logging enabled.');
  } else {
    log('[LOGGER] Firebase logging disabled.');
    _fbRef = null;
  }
}

function setFileLogging(val) {
  if (val === true) {
    _logToFile = true;
    log('[LOGGER] Local file logging enabled: ' + _logFile);
  } else {
    log('[LOGGER] Local file logging disabled.');
    _logToFile = false;
  }
}

function setLogFileName(filename) {
  if (filename) {
    _logFile = filename;
    log('[LOGGER] Saving log information to: ' + filename);
  } else {
    _logFile = _logFileDefault;
    warn('[LOGGER] Log filename not provided, using default');
  }
}

function setVerbose(verbose) {
  if (verbose === true) {
    _verbose = true;
    log('[LOGGER] Logger verbose: TRUE');
  } else {
    _verbose = false;
    log('[LOGGER] Logger verbose: FALSE');
  }
}

function setDebug(debug) {
  if (debug === true) {
    _logDebug = true;
    log('[LOGGER] Logger debug level: DEBUG');
  } else {
    log('[LOGGER] Logger debug level: NORMAL');
    _logDebug = false;
  }
}

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
    levelColor = colors.cyan;
  } else if (level === 'INIT' || level === 'START') {
    levelColor = colors.green;
  } else if (level === 'TODO') {
    levelColor = colors.magenta;
  } else if (level === 'DEBUG') {
    levelColor = colors.blue;
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
  printLogObj(logObj);
  if (_fbRef) {
    try {
      _fbRef.child('logs/logs').push(logObj, function(err) {
        if (err) {
          var message = '[LOGGER] Unable to write log to Firebase. (CB)';
          saveLog(generateLog('ERROR', message, err));
        }
      });
    } catch (ex) {
      _fbRef = null;
      var message = '[LOGGER] Unable to write log to Firebase. (TC)';
      saveLog(generateLog('ERROR', message, ex));
    }
  }
  if (_logToFile === true && _logFile) {
    var formattedLevel = ('     ' + logObj.level).slice(-5);
    var strLog = logObj.date_ + ' | ' + formattedLevel + ' | ';
    strLog += logObj.message;
    if (logObj.error) {
      strLog += '\n' + 'EXCEPTION: ';
      strLog += util.inspect(logObj.error, {showHidden: true, colors: false});
    }
    try {
      fs.appendFile(_logFile, strLog + '\n', function(err) {
        if (err) {
          _logToFile = false;
          var message = '[LOGGER] Unable to write log file. (CB)';
          saveLog(generateLog('ERROR', message, err));
        }
      });
    } catch (ex) {
      _logToFile = false;
      var message = '[LOGGER] Unable to write log file. (TC)';
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
  if (_verbose) {
    var logObj = generateLog('DEBUG', message);
    if (_logDebug === true) {
      saveLog(logObj);
    } else {
      printLogObj(logObj);
    }
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

function cleanLogs(path, maxAgeDays) {
  if (!_fbRef) {
    error('[LOGGER] Cannot clean logs, Firebase reference not set.');
    return;
  }
  if (path.indexOf('logs/') !== 0) {
    error('[LOGGER] Cannot clean logs, invalid path provided.');
    return;
  }
  maxAgeDays = maxAgeDays || 365;
  var endAt = Date.now() - (1000 * 60 * 60 * 24 * maxAgeDays);
  var msg = '[LOGGER] Cleaning logs from (' + path + ') older than ';
  msg += moment(endAt).format('YYYY-MM-DDTHH:mm:ss.SSS');
  log(msg);
  _fbRef.child(path).orderByChild('date').endAt(endAt).once('value',
    function(snapshot) {
      var itemsRemoved = 0;
      snapshot.forEach(function(item) {
        item.ref().remove();
        itemsRemoved++;
      });
      var msgCompleted = '[LOGGER] Cleaned logs from (' + path + '), ';
      msgCompleted += 'removed ' + itemsRemoved.toString() + ' items.';
      log(msgCompleted);
    }
  );
}

exports.cleanLogs = cleanLogs;
exports.setFirebase = setFirebase;
exports.setVerbose = setVerbose;
exports.setLogFileName = setLogFileName;
exports.setFileLogging = setFileLogging;
exports.setDebug = setDebug;
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
