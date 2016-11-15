'use strict';

var fs = require('fs');
var util = require('util');
var path = require('path');
var zlib = require('zlib');
var colors = require('colors');
var gitHead = require('./version');
var moment = require('moment');

var FIREBASE_LOG_PATH = 'logs/logs';
var logLevels = {
  START: {level: 0, color: colors.green},
  STOP: {level: 0, color: colors.red},
  INIT: {level: 0, color: colors.green},
  EXCPT: {level: 0, color: colors.red},
  ERROR: {level: 10, color: colors.red},
  WARN: {level: 40, color: colors.yellow},
  INFO: {level: 50, color: colors.cyan},
  TODO: {level: 60, color: colors.magenta},
  DEBUG: {level: 60, color: colors.blue},
  EXTRA: {level: 70, color: colors.blue}
};
var _fbRef = null;
var _fbErrors = 0;
var _fbLogCache = [];
var _options = {
  appName: null,
  logToFile: false,
  logFileName: './logs/system.log',
  logToFirebase: false,
  logLevel: {
    console: 90,
    file: 50,
    firebase: 50
  },
  verbose: false
};

function appStart(appName, options) {
  if (!appName) {
    throw new Error('No appName provided.');
  }
  _options.appName = appName;
  var msg = appName + ' (' + gitHead.head + ')';
  var logObj = generateLog('START', 'APP', msg);
  if (options) {
    setOptions(options);
  }
  handleLog(logObj);
}

function appStop(receivedFrom) {
  if (!receivedFrom) {
    receivedFrom = 'UNKNOWN';
  }
  var logObj = generateLog('STOP', 'APP', 'Received from: ' + receivedFrom);
  handleLog(logObj);
}

function setOptions(options) {
  if (options.hasOwnProperty('logToFile')) {
    _options.logToFile = options.logToFile;
  }
  if (options.logFileName) {
    _options.logFileName = options.logFileName;
  }
  if (options.hasOwnProperty('logToFirebase')) {
    _options.logToFirebase = options.logToFile;
  }
  if (options.hasOwnProperty('verbose')) {
    _options.verbose = options.verbose;
  }
  if (options.logLevel) {
    if (options.logLevel.console) {
      _options.logLevel.console = options.logLevel.console;
    }
    if (options.logLevel.file) {
      _options.logLevel.file = options.logLevel.file;
    }
    if (options.logLevel.firebase) {
      _options.logLevel.firebase = options.logLevel.firebase;
    }
  }
  log('LOGGER', 'setOptions', options);
}

function setFirebaseRef(fbRef) {
  if (fbRef) {
    _fbErrors = 0;
    var logObj = _fbLogCache.shift();
    while (logObj) {
      fbRef.child(FIREBASE_LOG_PATH).push(logObj);
      logObj = _fbLogCache.shift();
    }
  }
  _fbRef = fbRef;
}

function stringify(obj) {
  if (typeof obj === 'string') {
    return obj;
  }
  try {
    var result = JSON.stringify(obj);
    return result;
  } catch (ex) {
    return util.inspect(obj, {depth: 3});
  }
}

function generateLog(level, prefix, message, extra) {
  var now = Date.now();
  var nowPretty = moment(now).format('YYYY-MM-DDTHH:mm:ss.SSS');
  var levelValue = getLogLevelValueByName(level);
  var msg = '';
  if (prefix) {
    msg += '[' + prefix.toUpperCase() + '] ';
  }
  msg += stringify(message);
  var result = {
    appName: _options.appName,
    date: now,
    dateFormatted: nowPretty,
    level: level,
    levelValue: levelValue,
    prefix: prefix,
    message: msg,
    rawMessage: message,
    version: gitHead.head
  };
  if (extra) {
    result.extra = extra;
    if (extra.message) {
      result.exceptionMessage = extra.message;
    }
  }
  return result;
}

function getLogLevelValueByName(levelName) {
  var logInfo = logLevels[levelName];
  if (logInfo) {
    return logInfo.level;
  }
  return 50;
}

function getLogColorByName(levelName) {
  var logInfo = logLevels[levelName];
  if (logInfo) {
    return logInfo.color;
  }
  return colors.green;
}

function handleLog(logObj) {
  var logLevel = getLogLevelValueByName(logObj.level);
  if (logLevel <= _options.logLevel.console) {
    printLog(logObj);
  }
  if (_options.logToFirebase === true && logLevel <= _options.logLevel.firebase) {
    saveLogToFB(logObj);
  }
  if (_options.logToFile === true && logLevel <= _options.logLevel.file) {
    saveLogToFile(logObj);
  }
}

function printLog(logObj) {
  var formattedLevel = ('     ' + logObj.level).slice(-5);
  var levelColor = getLogColorByName(logObj.level);
  var msg = [];
  msg.push(logObj.date_ || logObj.dateFormatted);
  msg.push(levelColor(formattedLevel));
  msg.push(logObj.message);
  console.log(msg.join(' | '));
  if (logObj.extra) {
    if (logObj.extra.stack) {
      console.log(logObj.extra.stack);
    } else {
      var inspectOpt = {colors: true, depth: 3};
      var extra = util.inspect(logObj.extra, inspectOpt);
      console.log(extra);
    }
  }
  if (logObj.exceptionMessage) {
    // var exMsg = '2016-11-15T12:12:52.029 | EXCPT |'
    var exMsg = '                        | ';
    exMsg += colors.red('EXCPT') + ' | ' + logObj.exceptionMessage;
    // exMsg += logObj.exceptionMessage;
    console.log(exMsg);
  }
}

function saveLogToFB(logObj) {
  if (_fbRef) {
    try {
      _fbRef.child(FIREBASE_LOG_PATH).push(logObj);
    } catch (ex) {
      exception('LOGGER', 'Error pushing log item to Firebase', ex);
      if (_fbErrors++ > 3) {
        warn('LOGGER', 'Disabling Firebase logging.');
        _options.logToFirebase = false;
      }
    }
  } else {
    _fbLogCache.push(logObj);
    if (_fbLogCache.length > 500) {
      warn('LOGGER', 'Firebase Log Cache exceeded max capacity.');
      _options.logToFirebase = false;
    }
  }
}

function saveLogToFile(logObj) {
  if (_options.logFileName) {
    var msg = logObj.dateFormatted;
    msg +=  ' | ' + ('     ' + logObj.level).slice(-5) + ' | ';
    msg += logObj.message + '\n';
    if (logObj.extra) {
      if (logObj.extra.stack) {
        msg += logObj.extra.stack + '\n';
      } else {
        var inspectOpt = {showHidden: false, depth: 3};
        msg += util.inspect(logObj.extra, inspectOpt) + '\n';
      }
    }
    try {
      fs.appendFile(_options.logFileName, msg, function(err) {
        if (err) {
          _options.logToFile = false;
          exception('LOGGER', 'Unable to write to log file.', err);
        }
      });
    } catch (ex) {
      _options.logToFile = false;
      exception('LOGGER', 'Unable to write to log file.', ex);
    }
  }
}

function log(prefix, message, extra) {
  var logObj = generateLog('INFO', prefix, message, extra);
  handleLog(logObj);
}

function warn(prefix, message, extra) {
  var logObj = generateLog('WARN', prefix, message, extra);
  handleLog(logObj);
}

function error(prefix, message, extra) {
  var logObj = generateLog('ERROR', prefix, message, extra);
  handleLog(logObj);
}

function exception(prefix, message, extra) {
  var logObj = generateLog('EXCPT', prefix, message, extra);
  handleLog(logObj);
}

function debug(prefix, message, extra) {
  var logObj = generateLog('DEBUG', prefix, message, extra);
  handleLog(logObj);
}

function verbose(prefix, message, extra) {
  var logObj = generateLog('EXTRA', prefix, message, extra);
  handleLog(logObj);
}

function todo(prefix, message, extra) {
  var logObj = generateLog('TODO', prefix, message, extra);
  handleLog(logObj);
}

function init(prefix, message, extra) {
  var logObj = generateLog('INIT', prefix, message, extra);
  handleLog(logObj);
}

function http(method, message, extra) {
  var logObj = generateLog('HTTP', method, message, extra);
  handleLog(logObj);
}

function custom(level, prefix, message, extra) {
  level = level.toUpperCase().substring(0, 5);
  var logObj = generateLog(level, prefix, message, extra);
  handleLog(logObj);
}

function cleanFile(logFile) {
  if (!logFile) {
    logFile = _options.logFileName;
  }
  var msg = 'Cleaning log file: ' + logFile;
  fs.stat(logFile, function(err, stats) {
    if (err) {
      if (err.code === 'ENOENT') {
        msg += ' - file does not exist.';
        log('LOGGER', msg);
        return;
      }
      msg += ' - Failed.';
      exception('LOGGER', msg, err);
      return;
    }
    if (stats) {
      var exceedsAge = false;
      var exceedsSize = false;
      if (stats.size > 250000) {
        exceedsSize = true;
      }
      var oneWeek = moment().subtract(7, 'days');
      exceedsAge = moment(stats.birthtime).isBefore(oneWeek);
      if (exceedsAge || exceedsSize) {
        log('LOGGER', msg);
        try {
          var gzip = zlib.createGzip();
          var inp = fs.createReadStream(logFile);
          var out = fs.createWriteStream(logFile + '.gz');
          inp.pipe(gzip).pipe(out);
          fs.unlinkSync(logFile);
        } catch (ex) {
          exception('LOGGER', msg + ' - Failed with exception.', ex);
        }
      } else {
        debug('LOGGER', msg + ' - no action required.');
      }
    }
  });
}

function cleanLogs(path, maxAgeDays) {
  if (!_fbRef) {
    error('LOGGER', 'Cannot clean logs, Firebase reference not set.');
    return;
  }
  if (path.indexOf('logs/') !== 0) {
    error('LOGGER', 'Cannot clean logs, invalid path provided.');
    return;
  }
  maxAgeDays = maxAgeDays || 365;
  var endAt = Date.now() - (1000 * 60 * 60 * 24 * maxAgeDays);
  var msg = 'Cleaning logs from (' + path + ') older than ';
  msg += moment(endAt).format('YYYY-MM-DDTHH:mm:ss.SSS');
  log('LOGGER', msg);
  _fbRef.child(path).orderByChild('date').endAt(endAt).once('value',
    function(snapshot) {
      var itemsRemoved = 0;
      snapshot.forEach(function(item) {
        item.ref().remove();
        itemsRemoved++;
      });
      var msgCompleted = 'Cleaned logs from (' + path + '), ';
      msgCompleted += 'removed ' + itemsRemoved.toString() + ' items.';
      log('LOGGER', msgCompleted);
    }
  );
}

exports.appStart = appStart;
exports.appStop = appStop;
exports.init = init;
exports.exception = exception;
exports.error = error;
exports.warn = warn;
exports.log = log;
exports.info = log;
exports.debug = debug;
exports.verbose = verbose;
exports.http = http;
exports.todo = todo;
exports.custom = custom;
exports.cleanLogs = cleanLogs;
exports.cleanFile = cleanFile;
exports.setFirebaseRef = setFirebaseRef;
exports.setOptions = setOptions;
exports.version = gitHead.head;
exports.printLog = printLog;
