'use strict';

/** @module */

const fs = require('fs');
const util = require('util');
const zlib = require('zlib');
const colors = require('colors');
const gitHead = require('./version');
const moment = require('moment');

const FIREBASE_LOG_PATH = 'logs/logs';
const LOG_LEVELS = {
  START: {level: 0, color: colors.green},
  STOP: {level: 0, color: colors.red},
  INIT: {level: 0, color: colors.green},
  EXCPT: {level: 0, color: colors.red},
  ERROR: {level: 10, color: colors.red},
  WARN: {level: 40, color: colors.yellow},
  INFO: {level: 50, color: colors.cyan},
  TODO: {level: 60, color: colors.magenta},
  DEBUG: {level: 60, color: colors.blue},
  EXTRA: {level: 70, color: colors.blue},
};

let _fbRef = null;
let _fbErrors = 0;
let _fbLogCache = [];
let _options = {
  appName: null,
  logToFile: false,
  logFileName: './logs/system.log',
  logToFirebase: false,
  logLevel: {
    console: 90,
    file: 50,
    firebase: 50,
  },
  verbose: false,
};

/**
 * Log an App start
 *
 * @function appStart
 * @static
 * @param {String} appName The new state to
 * @param {Object} options Message to attach to the event
 */
function _appStart(appName, options) {
  if (!appName) {
    throw new Error('No appName provided.');
  }
  _options.appName = appName;
  const logObj = _generateLog('START', 'APP', `${appName}  (${gitHead.head})`);
  if (options) {
    _setOptions(options);
  }
  _handleLog(logObj);
}

/**
 * Log an App stop
 *
 * @function appStop
 * @static
 * @param {String} receivedFrom Who is requesting the app to stop
 */
function _appStop(receivedFrom) {
  if (!receivedFrom) {
    receivedFrom = 'UNKNOWN';
  }
  const logObj = _generateLog('STOP', 'APP', 'Received from: ' + receivedFrom);
  _handleLog(logObj);
}

/**
 * Sets or updates the options for the logger
 *
 * @function setOptions
 * @static
 * @param {Object} options The options to set
 */
function _setOptions(options) {
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
  _log('LOGGER', 'setOptions', options);
}

/**
 * Sets Firebase reference
 *
 * @function setFirebaseRef
 * @static
 * @param {Object} fbRef A Firebase reference
 */
function _setFirebaseRef(fbRef) {
  if (fbRef) {
    _fbErrors = 0;
    let logObj = _fbLogCache.shift();
    while (logObj) {
      fbRef.child(FIREBASE_LOG_PATH).push(logObj);
      logObj = _fbLogCache.shift();
    }
  }
  _fbRef = fbRef;
}

/**
 * Stringifies an Object
 *
 * @param {*} obj The Object to stringify
 * @return {String} A string representation of the object
 */
function _stringify(obj) {
  if (typeof obj === 'string') {
    return obj;
  }
  try {
    return JSON.stringify(obj);
  } catch (ex) {
    return util.inspect(obj, {depth: 3});
  }
}

/**
 * Generate a log object
 *
 * @param {String} level The level of the log message
 * @param {String} prefix Where the message originated
 * @param {String} message The log message
 * @param {Object} [extra] Any extra info, including exceptions, etc
 * @return {Object} The log object
 */
function _generateLog(level, prefix, message, extra) {
  const now = Date.now();
  const nowPretty = moment(now).format('YYYY-MM-DDTHH:mm:ss.SSS');
  const levelValue = _getLogLevelValueByName(level);
  let msg = '';
  if (prefix) {
    msg += '[' + prefix.toUpperCase() + '] ';
  }
  msg += _stringify(message);
  let result = {
    appName: _options.appName,
    date: now,
    dateFormatted: nowPretty,
    level: level,
    levelValue: levelValue,
    prefix: prefix,
    message: msg,
    rawMessage: message,
    version: gitHead.head,
  };
  if (extra) {
    if (typeof extra === 'string') {
      result.extra = extra;
    } else {
      result.extra = JSON.stringify(extra);
    }
    if (extra.message) {
      result.exceptionMessage = extra.message;
    }
  }
  return result;
}

/**
 * Gets the log level based on the provided name.
 *   If the level name isn't found, default to 50.
 *
 * @param {String} levelName The level name.
 * @return {Number} The log level value.
 */
function _getLogLevelValueByName(levelName) {
  const logInfo = LOG_LEVELS[levelName];
  if (logInfo) {
    return logInfo.level;
  }
  return 50;
}

/**
 * Get the color of the log levelby name.
 *   If no level is found, default to green.
 *
 * @param {String} levelName The level name.
 * @return {Object} A colors object with the color
 */
function _getLogColorByName(levelName) {
  const logInfo = LOG_LEVELS[levelName];
  if (logInfo) {
    return logInfo.color;
  }
  return colors.green;
}

/**
 * Print/Save to Firebase/Save to File.
 *
 * @param {Object} logObj The log object to handle.
 */
function _handleLog(logObj) {
  const logLevel = _getLogLevelValueByName(logObj.level);
  if (logLevel <= _options.logLevel.console) {
    _printLog(logObj);
  }
  if (_options.logToFirebase === true &&
      logLevel <= _options.logLevel.firebase) {
    _saveLogToFB(logObj);
  }
  if (_options.logToFile === true && logLevel <= _options.logLevel.file) {
    _saveLogToFile(logObj);
  }
}

/**
 * Prints the lob object to the console.
 *
 * @function printLog
 * @static
 * @param {Object} logObj The log object to print.
 */
function _printLog(logObj) {
  const formattedLevel = ('     ' + logObj.level).slice(-5);
  const levelColor = _getLogColorByName(logObj.level);
  let msg = [];
  msg.push(logObj.date_ || logObj.dateFormatted);
  msg.push(levelColor(formattedLevel));
  msg.push(logObj.message);
  // eslint-disable-next-line no-console
  console.log(msg.join(' | '));
  if (logObj.exceptionMessage) {
    let exMsg = '                        | ';
    exMsg += colors.red('EXCPT') + ' | ' + logObj.exceptionMessage;
    // eslint-disable-next-line no-console
    console.log(exMsg);
  }
  if (logObj.extra) {
    if (logObj.extra.stack) {
      // eslint-disable-next-line no-console
      console.log(logObj.extra.stack);
    } else {
      const inspectOpt = {colors: true, depth: 3};
      // eslint-disable-next-line no-console
      console.log(util.inspect(logObj.extra, inspectOpt));
    }
  }
}

/**
 * Saves a log object to Firebase.
 *
 * @param {Object} logObj The log object to save
 */
function _saveLogToFB(logObj) {
  if (logObj.levelValue > 50) {
    return;
  }
  if (_fbRef) {
    try {
      _fbRef.child(FIREBASE_LOG_PATH).push(logObj);
      _fbErrors = 0;
    } catch (ex) {
      _exception('LOGGER', 'Error pushing log item to Firebase', ex);
      if (_fbErrors++ > 3) {
        _warn('LOGGER', 'Disabling Firebase logging.');
        _options.logToFirebase = false;
      }
    }
  } else {
    _fbLogCache.push(logObj);
    if (_fbLogCache.length > 500) {
      _warn('LOGGER', 'Firebase Log Cache exceeded max capacity.');
      _options.logToFirebase = false;
    }
  }
}

/**
 * Save a log object to the log file.
 *
 * @param {Object} logObj The log object to save.
 */
function _saveLogToFile(logObj) {
  if (_options.logFileName) {
    let msg = logObj.dateFormatted;
    msg += ' | ' + ('     ' + logObj.level).slice(-5) + ' | ';
    msg += logObj.message + '\n';
    if (logObj.extra) {
      if (logObj.extra.stack) {
        msg += logObj.extra.stack + '\n';
      } else {
        const inspectOpt = {showHidden: false, depth: 3};
        msg += util.inspect(logObj.extra, inspectOpt) + '\n';
      }
    }
    try {
      fs.appendFile(_options.logFileName, msg, function(err) {
        if (err) {
          _options.logToFile = false;
          _exception('LOGGER', 'Unable to write to log file.', err);
        }
      });
    } catch (ex) {
      _options.logToFile = false;
      _exception('LOGGER', 'Unable to write to log file.', ex);
    }
  }
}

/**
 * Logs a message.
 *
 * @function log
 * @static
 * @param {String} prefix Where the message originated.
 * @param {String} message The log message.
 * @param {Object} [extra] Optional extra information.
 */
function _log(prefix, message, extra) {
  _handleLog(_generateLog('INFO', prefix, message, extra));
}

/**
 * Logs a warning.
 *
 * @function warn
 * @static
 * @param {String} prefix Where the message originated.
 * @param {String} message The log message.
 * @param {Object} [extra] Optional extra information.
 */
function _warn(prefix, message, extra) {
  _handleLog(_generateLog('WARN', prefix, message, extra));
}

/**
 * Logs an error.
 *
 * @function error
 * @static
 * @param {String} prefix Where the message originated.
 * @param {String} message The log message.
 * @param {Object} [extra] Optional extra information.
 */
function _error(prefix, message, extra) {
  _handleLog(_generateLog('ERROR', prefix, message, extra));
}

/**
 * Logs an exception.
 *
 * @function exception
 * @static
 * @param {String} prefix Where the message originated.
 * @param {String} message The log message.
 * @param {Object} [extra] Optional extra information.
 */
function _exception(prefix, message, extra) {
  _handleLog(_generateLog('EXCPT', prefix, message, extra));
}

/**
 * Logs a debug message.
 *
 * @function debug
 * @static
 * @param {String} prefix Where the message originated.
 * @param {String} message The log message.
 * @param {Object} [extra] Optional extra information.
 */
function _debug(prefix, message, extra) {
  _handleLog(_generateLog('DEBUG', prefix, message, extra));
}

/**
 * Logs a verbose message.
 *
 * @function verbose
 * @static
 * @param {String} prefix Where the message originated.
 * @param {String} message The log message.
 * @param {Object} [extra] Optional extra information.
 */
function _verbose(prefix, message, extra) {
  _handleLog(_generateLog('EXTRA', prefix, message, extra));
}

/**
 * Logs a TO DO message.
 *
 * @function todo
 * @static
 * @param {String} prefix Where the message originated.
 * @param {String} message The log message.
 * @param {Object} [extra] Optional extra information.
 */
function _todo(prefix, message, extra) {
  _handleLog(_generateLog('TODO', prefix, message, extra));
}

/**
 * Logs a init message.
 *
 * @function init
 * @static
 * @param {String} prefix Where the message originated.
 * @param {String} message The log message.
 * @param {Object} [extra] Optional extra information.
 */
function _init(prefix, message, extra) {
  _handleLog(_generateLog('INIT', prefix, message, extra));
}

/**
 * Logs an HTTP message.
 *
 * @function http
 * @static
 * @param {String} method The type of HTTP request made.
 * @param {String} message The log message.
 * @param {Object} [extra] Optional extra information.
 */
function _http(method, message, extra) {
  _handleLog(_generateLog('HTTP', method, message, extra));
}

/**
 * Logs a custom message.
 *
 * @function custom
 * @static
 * @param {String} level The level of the message.
 * @param {String} prefix Where the message originated.
 * @param {String} message The log message.
 * @param {Object} [extra] Optional extra information.
 */
function _custom(level, prefix, message, extra) {
  level = level.toUpperCase().substring(0, 5);
  _handleLog(_generateLog(level, prefix, message, extra));
}

/**
 * Cleans the log file.
 *
 * @function cleanFile
 * @static
 * @param {String} logFile The file to be cleaned.
 */
function _cleanFile(logFile) {
  if (!logFile) {
    logFile = _options.logFileName;
  }
  let msg = 'Cleaning log file: ' + logFile;
  fs.stat(logFile, function(err, stats) {
    if (err) {
      if (err.code === 'ENOENT') {
        msg += ' - file does not exist.';
        _log('LOGGER', msg);
        return;
      }
      msg += ' - Failed.';
      _exception('LOGGER', msg, err);
      return;
    }
    if (stats) {
      let exceedsAge = false;
      let exceedsSize = false;
      if (stats.size > 250000) {
        exceedsSize = true;
      }
      const oneWeek = moment().subtract(7, 'days');
      exceedsAge = moment(stats.birthtime).isBefore(oneWeek);
      if (exceedsAge || exceedsSize) {
        _log('LOGGER', msg);
        try {
          let gzip = zlib.createGzip();
          let inp = fs.createReadStream(logFile);
          let out = fs.createWriteStream(logFile + '.gz');
          inp.pipe(gzip).pipe(out);
          fs.unlinkSync(logFile);
        } catch (ex) {
          _exception('LOGGER', msg + ' - Failed with exception.', ex);
        }
      } else {
        _debug('LOGGER', msg + ' - no action required.');
      }
    }
  });
}

/**
 * Cleans/removes old log messages from Firebase.
 *
 * @function cleanLogs
 * @static
 * @param {String} path The Firebase path to clean.
 * @param {Number} maxAgeDays Remove any log item older than x days.
 */
function _cleanLogs(path, maxAgeDays) {
  if (!_fbRef) {
    _error('LOGGER', 'Cannot clean logs, Firebase reference not set.');
    return;
  }
  if (path.indexOf('logs/') !== 0) {
    _error('LOGGER', 'Cannot clean logs, invalid path provided.');
    return;
  }
  maxAgeDays = maxAgeDays || 365;
  const endAt = Date.now() - (1000 * 60 * 60 * 24 * maxAgeDays);
  let msg = 'Cleaning logs from (' + path + ') older than ';
  msg += moment(endAt).format('YYYY-MM-DDTHH:mm:ss.SSS');
  _log('LOGGER', msg);
  _fbRef.child(path).orderByChild('date').endAt(endAt).once('value',
    function(snapshot) {
      let itemsRemoved = 0;
      snapshot.forEach(function(item) {
        item.ref().remove();
        itemsRemoved++;
      });
      let msgCompleted = 'Cleaned logs from (' + path + '), ';
      msgCompleted += 'removed ' + itemsRemoved.toString() + ' items.';
      _log('LOGGER', msgCompleted);
    }
  );
}

exports.appStart = _appStart;
exports.appStop = _appStop;
exports.init = _init;
exports.exception = _exception;
exports.error = _error;
exports.warn = _warn;
exports.log = _log;
exports.info = _log;
exports.debug = _debug;
exports.verbose = _verbose;
exports.http = _http;
exports.todo = _todo;
exports.custom = _custom;
exports.cleanLogs = _cleanLogs;
exports.cleanFile = _cleanFile;
exports.setFirebaseRef = _setFirebaseRef;
exports.setOptions = _setOptions;
exports.version = gitHead.head;
exports.printLog = _printLog;
