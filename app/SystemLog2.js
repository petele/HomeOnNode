'use strict';

/** @module */

const os = require('os');
const fs = require('fs');
const util = require('util');
const zlib = require('zlib');
const chalk = require('chalk');
const moment = require('moment');
const gitHead = require('./version');
const WSServer = require('./WSServer');
const stripAnsi = require('strip-ansi');

const HOSTNAME = os.hostname();
const DEFAULT_OPTIONS = {
  fileLogLevel: 50,
  fileFilename: './logs/system.log',
  consoleLogLevel: 90,
  firebaseLogLevel: -1,
  firebasePath: 'logs/generic',
};
const LOG_LEVELS = {
  /* eslint-disable no-multi-spaces */
  START: {level: 0, color: chalk.hex('#388e3c')},  // green 700
  STOP: {level: 0, color: chalk.hex('#b71c1c')},   // red 900
  INIT: {level: 0, color: chalk.hex('#388e3c')},   // green 700
  EXCPT: {level: 0, color: chalk.hex('#b71c1c')},  // red 900
  FATAL: {level: 0, color: chalk.hex('#b71c1c')},  // red 900
  ERROR: {level: 10, color: chalk.hex('#f44336')}, // red 500
  WARN: {level: 40, color: chalk.hex('#ff9800')},  // orange 500
  INFO: {level: 50, color: chalk.hex('#03a9f4')},  // light blue 500
  TODO: {level: 60, color: chalk.hex('#9c27b0')},  // purple 500
  DEBUG: {level: 60, color: chalk.hex('#0d47a1')}, // blue 800
  EXTRA: {level: 70, color: chalk.hex('#546e7a')}, // bluegray 600
  /* eslint-enable */
};
const LOG_PREFIX = 'LOGGER';

let _appName = null;
let _fbRef = null;
let _fbLogCache = [];
let _fbErrorCount = 0;
let _fbLastError = 0;
let _opts = DEFAULT_OPTIONS;
let _wss;


/**
 * Sets up the WebSocket logging server.
 *
 * @static
 * @param {Number} [port] - The port to use.
 */
function _startWSS(port) {
  if (_wss) {
    _error(LOG_PREFIX, 'WebSocket server is already running.');
    return;
  }
  if (!port) {
    port = 8881;
  }
  _init(LOG_PREFIX, `Starting WebSocket server on port ${port}`);
  _wss = new WSServer('LOG', port);
}

/**
 * Sets the system wide app name.
 *
 * @function setAppName
 * @static
 * @param {String} appName - The name of the app
 */
function _setAppName(appName) {
  if (!appName) {
    throw new Error('`appName` is a required parameter.');
  }
  if (_appName) {
    throw new Error('`appName` is already set.');
  }
  _appName = appName;
}

/**
 * Sets or updates the options for the logger
 *
 * @function setOptions
 * @static
 * @param {Object} options The options to set
 */
function _setOptions(options) {
  if (!options) {
    return;
  }
  let newOpts = {};
  const keys = Object.keys(DEFAULT_OPTIONS);
  keys.forEach(function(key) {
    newOpts[key] = options[key] || DEFAULT_OPTIONS[key];
  });
  _opts = newOpts;
  _log(LOG_PREFIX, `setOptions(${JSON.stringify(options)})`);
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
    let logObj = _fbLogCache.shift();
    while (logObj) {
      fbRef.child(_opts.firebasePath).push(logObj);
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
  const nowPretty = _formatTime(now);
  const levelValue = _getLogLevelValueByName(level);
  let msg = '';
  if (prefix) {
    msg += '[' + prefix.toUpperCase() + '] ';
  }
  msg += _stringify(message);
  let result = {
    appName: _appName,
    hostname: HOSTNAME,
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
    if (extra instanceof Error) {
      result.exception = {
        message: extra.message,
        name: extra.name,
      };
      if (extra.stack) {
        result.exception.stack = extra.stack;
      }
    } else if (typeof extra === 'string') {
      result.extra = extra;
    } else {
      try {
        result.extra = JSON.parse(JSON.stringify(extra));
      } catch (ex) {
        result.extra = {circular: true};
        _exception(LOG_PREFIX, 'generateLog() circular exception', ex);
      }
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
  return chalk.green;
}

/**
 * Print/Save to Firebase/Save to File.
 *
 * @param {Object} logObj The log object to handle.
 */
function _handleLog(logObj) {
  const stringifiedLogObj = _stringifyLog(logObj);
  if (logObj.levelValue <= _opts.consoleLogLevel) {
    // eslint-disable-next-line no-console
    console.log(stringifiedLogObj);
  }
  if (logObj.levelValue <= _opts.fileLogLevel) {
    _saveLogToFile(stringifiedLogObj);
  }
  if (logObj.levelValue <= _opts.firebaseLogLevel) {
    _saveLogToFirebase(logObj);
  }
  _sendLogToWSS(logObj);
}

/**
 * Stringifies a logObj into a string.
 *
 * @function stringifyLog
 * @static
 * @param {Object} logObj The log object to print.
 * @return {String}
 */
function _stringifyLog(logObj) {
  const dt = _formatTime(logObj.date);
  const levelColor = _getLogColorByName(logObj.level);
  const level = levelColor(('     ' + logObj.level).slice(-5));
  let result = `${dt} | ${level} | ${logObj.message}`;
  let extra = [];
  let prefix = `                        | ${level} | `;
  if (logObj.exception) {
    if (logObj.exception.stack) {
      logObj.exception.stack.split('\n').forEach((l) => {
        extra.push(`${prefix} ${l}`);
      });
    } else {
      extra.push(`${prefix} ${logObj.exception.message}`);
    }
  }
  if (logObj.extra) {
    const opts = {colors: true, depth: 5};
    util.inspect(logObj.extra, opts).split('\n').forEach((l) => {
      extra.push(`${prefix} ${l}`);
    });
  }
  if (extra.length > 0) {
    result += '\n' + extra.join('\n');
  }
  return result;
}

/**
 * Saves a log object to Firebase.
 *
 * @param {Object} logObj The log object to save
 */
function _saveLogToFirebase(logObj) {
  if (_opts.firebaseLogLevel === -1 ||
      logObj.levelValue > _opts.firebaseLogLevel ||
      !_opts.firebasePath) {
    return;
  }
  if (!_fbRef) {
    _fbLogCache.push(logObj);
    if (_fbLogCache.length > 500) {
      _warn(LOG_PREFIX, 'Firebase log cache exceeded max capacity.');
      _opts.firebaseLogLevel = -1;
    }
    return;
  }
  const now = Date.now();
  if (_fbErrorCount > 0) {
    if ((now - _fbLastError) > (10 * 60 * 1000)) {
      _fbErrorCount = 0;
    } else if (_fbErrorCount > 5) {
      _opts.firebaseLogLevel = -1;
      _warn(LOG_PREFIX, 'Firebase error count exceeded.');
      return;
    }
  }
  try {
    _fbRef.child(_opts.firebasePath).push(logObj, function(err) {
      if (err) {
        _exception(LOG_PREFIX, 'Unable to log item to Firebase', err);
        _fbErrorCount++;
        _fbLastError = now;
        return;
      }
    });
  } catch (ex) {
    _exception(LOG_PREFIX, 'Exception trying to log to Firebase', ex);
    _fbErrorCount++;
    _fbLastError = now;
  }
}

/**
 * Save a log object to the log file.
 *
 * @param {String} stringifiedLogObj The log object to save.
 */
function _saveLogToFile(stringifiedLogObj) {
  try {
    const lines = stripAnsi(stringifiedLogObj) + '\n';
    fs.appendFile(_opts.fileFilename, lines, function(err) {
      if (err) {
        _opts.fileLogLevel = -1;
        _exception(LOG_PREFIX, 'Unable to write to log file.', err);
      }
    });
  } catch (ex) {
    _opts.fileLogLevel = -1;
    _exception(LOG_PREFIX, 'Exception while writing to log file.', ex);
  }
}

/**
 * Sends a log object to web socket server.
 *
 * @param {Object} logObj The log object to save.
 */
function _sendLogToWSS(logObj) {
  if (!_wss || _wss.running !== true) {
    return;
  }
  _wss.broadcast(JSON.stringify(logObj));
}

/**
 * Formats Date.now() into YYYY-MM-DDTHH:mm:ss[.SSS]
 *
 * @function formatTime
 * @static
 *
 * @param {Integer} now Date.now() Epoch time to convert
 * @param {Boolean} [short] Exclude MS in time
 * @return {String} YYYY-MM-DDTHH:mm:ss.SSS
 */
function _formatTime(now, short) {
  if (short === true) {
    return moment(now).format('YYYY-MM-DDTHH:mm:ss');
  }
  return moment(now).format('YYYY-MM-DDTHH:mm:ss.SSS');
}

/**
 * Logs a app start message.
 *
 * @function appStart
 * @static
 */
function _appStart() {
  if (!_appName) {
    throw new Error('`appName` has not been set.');
  }
  const message = `${_appName} (${gitHead.head})`;
  _handleLog(_generateLog('START', 'APP', message));
}

/**
 * Log an App stop
 *
 * @function appStop
 * @static
 * @param {String} receivedFrom Who is requesting the app to stop.
 * @param {Object} extra Extra shutdown data.
 */
function _appStop(receivedFrom, extra) {
  _handleLog(_generateLog('STOP', 'APP', 'Shutdown', extra));
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
 * Logs an fatal exception.
 *
 * @function fatal
 * @static
 * @param {String} prefix Where the message originated.
 * @param {String} message The log message.
 * @param {Object} [extra] Optional extra information.
 */
function _fatal(prefix, message, extra) {
  _handleLog(_generateLog('FATAL', prefix, message, extra));
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
 * @param {String} [logFile] The file to be cleaned.
 * @return {Promise}
 */
function _cleanFile(logFile) {
  return new Promise(function(resolve, reject) {
    if (!logFile) {
      logFile = _opts.fileFilename;
    }
    const msg = `cleanFile('${logFile}')`;
    _log(LOG_PREFIX, msg);
    fs.stat(logFile, function(err, stats) {
      if (err) {
        if (err.code === 'ENOENT') {
          _warn(LOG_PREFIX, msg + ' - file does not exist.');
          resolve(false);
          return;
        }
        _exception(LOG_PREFIX, msg + ' - failed to open file.', err);
        reject(err);
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
          try {
            _debug(LOG_PREFIX, msg + ' - compressing and removing file...');
            let gzip = zlib.createGzip();
            let inp = fs.createReadStream(logFile);
            let out = fs.createWriteStream(logFile + '.gz');
            inp.pipe(gzip).pipe(out);
            fs.unlinkSync(logFile);
            resolve(true);
            return;
          } catch (ex) {
            _exception(LOG_PREFIX, msg + ' - failed.', ex);
            reject(ex);
            return;
          }
        } else {
          _debug(LOG_PREFIX, msg + ' - no action required.');
          resolve(false);
          return;
        }
      }
    });
  });
}

/**
 * Cleans/removes old log messages from Firebase.
 *
 * @function cleanLogs
 * @static
 * @param {String} path The Firebase path to clean.
 * @param {Number} [maxAgeDays] Remove any log item older than x days.
 * @return {Promise}
 */
function _cleanLogs(path, maxAgeDays) {
  maxAgeDays = maxAgeDays || 365;
  let msg = `cleanLogs('${path}', ${maxAgeDays})`;
  _debug(LOG_PREFIX, msg);
  if (!_fbRef) {
    _error(LOG_PREFIX, 'Cannot clean logs, Firebase reference not set.');
    return Promise.reject(new Error('Firebase reference not set.'));
  }
  if (path.indexOf('logs/') !== 0) {
    _error(LOG_PREFIX, 'Cannot clean logs, invalid path provided.');
    return Promise.reject(new Error('Path must start with `logs`'));
  }
  const endAt = Date.now() - (1000 * 60 * 60 * 24 * maxAgeDays);
  const niceDate = _formatTime(endAt);
  _debug(LOG_PREFIX, `Removing items older than ${niceDate} from ${path}`);
  return _fbRef.child(path).orderByChild('date').endAt(endAt).once('value')
  .then((snapshot) => {
    const numChildren = snapshot.numChildren();
    if (numChildren >= 50000) {
      _warn(LOG_PREFIX, `${msg} - may fail, too many items!`);
    }
    _debug(LOG_PREFIX, `${msg} - found ${numChildren} items`);
    let promises = [];
    snapshot.forEach((item) => {
      promises.push(item.ref().remove());
    });
    return Promise.all(promises);
  })
  .then((values) => {
    return {path: path, count: values.length};
  });
}

exports.setAppName = _setAppName;
exports.setOptions = _setOptions;
exports.startWSS = _startWSS;
exports.setFirebaseRef = _setFirebaseRef;

exports.formatTime = _formatTime;
exports.stringifyLog = _stringifyLog;

exports.appStart = _appStart;
exports.appStop = _appStop;
exports.init = _init;
exports.log = _log;
exports.info = _log;
exports.exception = _exception;
exports.fatal = _fatal;
exports.error = _error;
exports.warn = _warn;
exports.debug = _debug;
exports.verbose = _verbose;
exports.http = _http;
exports.todo = _todo;
exports.custom = _custom;

exports.cleanLogs = _cleanLogs;
exports.cleanFile = _cleanFile;

exports.version = gitHead.head;
