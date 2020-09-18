'use strict';

/** @module */

const fs = require('fs');
const util = require('util');
const path = require('path');
const zlib = require('zlib');
const chalk = require('chalk');
const moment = require('moment');
const gitHead = require('./version');
const fsProm = require('fs/promises');
const FBHelper = require('./FBHelper');
const WSServer = require('./WSServer');
const stripAnsi = require('strip-ansi');
const honHelpers = require('./HoNHelpers');

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
const HOSTNAME = honHelpers.getHostname();
const LOG_PREFIX = 'LOGGER';

const _logOpts = {
  console: {
    level: 100,
  },
  file: {
    level: -1,
    logFile: './logs/system.log',
  },
  firebase: {
    level: -1,
    fbPath: null,
  },
};
let _appName = null;
let _fbRef = null;
const _fbLogCache = [];
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
  _wss = new WSServer('LOG', port);
}

/**
 * Get the current log options.
 *
 * @return {Object} Log options.
 */
function _getOpts() {
  return _logOpts;
}

/**
 * Set the Console log options.
 *
 * @param {Number} logLevel Log level.
 * @return {Boolean} true if completed successfully.
 */
async function _setConsoleLogOpts(logLevel) {
  logLevel = honHelpers.isValidInt(logLevel, -1, 100);
  if (logLevel === null) {
    _error(LOG_PREFIX, 'Invalid logLevel, must be -1 <= X <= 100', logLevel);
    return false;
  }
  _logOpts.console.level = logLevel;
  return true;
}

/**
 * Set the File log options.
 *
 * @param {Number} logLevel Log level.
 * @param {String} logFile File to log details to.
 * @return {Boolean} true if completed successfully.
 */
async function _setFileLogOpts(logLevel, logFile) {
  logLevel = honHelpers.isValidInt(logLevel, -1, 100);
  if (logLevel === null) {
    _error(LOG_PREFIX, 'Invalid logLevel, must be -1 <= X <= 100', logLevel);
    return false;
  }
  if (!logFile) {
    _error(LOG_PREFIX, 'Must provide a valid log file name.');
    return false;
  }
  try {
    const parsedFileName = path.parse(logFile);
    await fsProm.mkdir(parsedFileName.dir, {recursive: true});
  } catch (ex) {
    _error(LOG_PREFIX, `Invalid log file: ${logFile}`, ex);
    return false;
  }
  _logOpts.file.level = logLevel;
  _logOpts.file.logFile = logFile;
  return true;
}

/**
 * Set the Firebase log options.
 *
 * @param {Number} logLevel Log level.
 * @param {String} path Path to log results at.
 * @return {Boolean} true if completed successfully.
 */
async function _setFirebaseLogOpts(logLevel, path) {
  logLevel = honHelpers.isValidInt(logLevel, -1, 100);
  if (logLevel === null) {
    _error(LOG_PREFIX, 'Invalid logLevel, must be -1 <= X <= 100', logLevel);
    return false;
  }
  if (!path.startsWith('logs/')) {
    _error(LOG_PREFIX, `Firebase log path must start with 'logs/'`, path);
    return false;
  }
  _logOpts.firebase.level = logLevel;
  _logOpts.firebase.fbPath = path;

  const fbRootRef = await FBHelper.getRootRefUnlimited();
  const fbRef = await fbRootRef.child(path);

  let logObj = _fbLogCache.shift();
  while (logObj) {
    fbRef.push(logObj);
    logObj = _fbLogCache.shift();
  }
  _fbRef = fbRef;
  return true;
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
 * Checks an object for circular references, if the exist, replaces them
 * with '[Circular]' strings.
 *
 * @param {Object} obj Object to check and de-reference if necessary.
 * @return {Object} An object with circular references removed.
 */
function _removeCircularRefs(obj) {
  try {
    JSON.stringify(obj);
    return obj;
  } catch (ex) {
    // Has a circular reference.
    _verbose(LOG_PREFIX, `removeCircularRefs() has circular.`, ex);
  }
  try {
    const stringified = JSON.stringify(obj, _circularSerializer());
    return JSON.parse(stringified);
  } catch (ex) {
    _error(LOG_PREFIX, `_removeCircularRefs() failed.`, ex);
    // eslint-disable-next-line no-console
    console.log(obj);
    return {message: 'Unable to stringify object', error: ex};
  }
}

/**
 * Helper method for _checkForCircularRefs to check for circular references
 * and replace them with '[Circular]' strings.
 *
 * @param {*} replacer
 * @param {Function} cycleReplacer
 * @return {*}
 */
function _circularSerializer(replacer, cycleReplacer) {
  const stack = [];
  const keys = [];

  if (!cycleReplacer) {
    cycleReplacer = function(key, value) {
      if (stack[0] === value) {
        return `[Circular ~]`;
      }
      return `[Circular ~.${keys.slice(0, stack.indexOf(value)).join('.')}]`;
    };
  }

  return function(key, value) {
    // eslint-disable-next-line no-invalid-this
    const self = this;
    if (stack.length > 0) {
      const index = stack.indexOf(self);
      if (index === -1) {
        stack.push(self);
        keys.push(key);
      } else {
        stack.splice(index + 1);
        keys.splice(index, Infinity, key);
      }
      if (stack.includes(value)) {
        value = cycleReplacer.call(self, key, value);
      }
    } else {
      stack.push(value);
    }
    if (replacer) {
      return replacer.call(self, key, value);
    }
    return value;
  };
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
  const result = {
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
      result.extra = _removeCircularRefs(extra);
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
  if (logObj.levelValue <= _logOpts.console.level) {
    // eslint-disable-next-line no-console
    console.log(stringifiedLogObj);
  }
  if (logObj.levelValue <= _logOpts.file.level) {
    _saveLogToFile(stringifiedLogObj);
  }
  if (logObj.levelValue <= _logOpts.firebase.level) {
    _saveLogToFirebase(logObj);
  }
  setImmediate(() => {
    _sendLogToWSS(logObj);
  });
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
  const extra = [];
  const prefix = `                        | ${level} | `;
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
 * @return {Promise}
 */
function _saveLogToFirebase(logObj) {
  if (_logOpts.firebase.level === -1) {
    return;
  }
  if (logObj.levelValue > _logOpts.firebase.level) {
    return;
  }
  if (!_fbRef) {
    _fbLogCache.push(logObj);
    if (_fbLogCache.length > 500) {
      _fbLogCache.shift();
    }
    return;
  }
  return _fbRef.push(logObj)
      .catch((err) => {
        const msg = 'Unable to save log item to Firebase';
        _exception(LOG_PREFIX, msg, err);
      });
}

/**
 * Save a log object to the log file.
 *
 * @param {String} stringifiedLogObj The log object to save.
 * @return {Promise}
 */
function _saveLogToFile(stringifiedLogObj) {
  if (_logOpts.file.level === -1) {
    return;
  }
  const lines = stripAnsi(stringifiedLogObj) + '\n';
  return fsProm.appendFile(_logOpts.file.logFile, lines)
      .catch((err) => {
        _logOpts.file.level = -1;
        const msg = 'Unable to save log item to file';
        _exception(LOG_PREFIX, msg, err);
      });
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
 * Formats a duration to a human readable time.
 *
 * @function humanizeDuration
 * @static
 *
 * @param {Number} seconds Number of seconds to humanize.
 * @return {String} Amount of time passed.
 */
function _humanizeDuration(seconds) {
  const d = moment.duration(seconds, 'seconds');
  const result = [];
  const years = Math.floor(d.asYears());
  if (years) {
    result.push(`${years} years`);
    d.subtract(years, 'years');
  }
  const months = Math.floor(d.asMonths());
  if (months) {
    result.push(`${months} months`);
    d.subtract(months, 'months');
  }
  const days = Math.floor(d.asDays());
  if (days) {
    result.push(`${days} days`);
    d.subtract(days, 'days');
  }
  const hours = Math.floor(d.asHours());
  if (hours) {
    result.push(`${hours} hours`);
    d.subtract(hours, 'hours');
  }
  const minutes = Math.round(d.asMinutes());
  if (minutes) {
    result.push(`${minutes} minutes`);
  }
  if (result.length > 0) {
    return result.join(', ');
  }
  return `${Math.round(seconds)} seconds`;
}

/**
 * Logs a app start message.
 *
 * @function appStart
 * @static
 *
 * @param {String} appName Name of the app that's starting.
 */
function _appStart(appName) {
  _appName = appName;
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
 * @param {String} [file] The file to be cleaned.
 * @return {Promise}
 */
async function _cleanFile(file) {
  const logFile = file || _logOpts.file.logFile;
  const msg = `cleanFile('${logFile}')`;
  _log(LOG_PREFIX, msg);
  if (!logFile) {
    _error(LOG_PREFIX, `${msg} failed - no log file specified.`);
    return false;
  }
  let stats;
  try {
    stats = await fsProm.stat(logFile);
  } catch (ex) {
    if (ex.code === 'ENOENT') {
      _error(LOG_PREFIX, `${msg} failed - file does not exist.`, ex);
      return false;
    }
    _error(LOG_PREFIX, `${msg} failed - unable to read file.`, ex);
    return false;
  }
  if (!stats) {
    _error(LOG_PREFIX, `${msg} failed - no stats.`);
    return false;
  }
  const exceedsSize = stats.size > 250000;
  const oneWeek = moment().subtract(7, 'days');
  const exceedsAge = moment(stats.birthtime).isBefore(oneWeek);

  if (!exceedsAge && !exceedsSize) {
    _verbose(LOG_PREFIX, `${msg} skipped.`);
    return false;
  }

  try {
    _debug(LOG_PREFIX, `${msg} - compressing and removing file...`);
    const gzip = zlib.createGzip();
    const inp = fs.createReadStream(logFile);
    const out = fs.createWriteStream(logFile + '.gz');
    inp.pipe(gzip).pipe(out);
    await fsProm.unlink(logFile);
    _debug(LOG_PREFIX, `${msg} - completed.`);
    return true;
  } catch (ex) {
    _exception(LOG_PREFIX, `${msg} failed - unable to clean log file.`, ex);
    return false;
  }
}

/**
 * Cleans/removes old log messages from Firebase.
 *
 * @function cleanLogs
 * @static
 * @param {String} [path] Path of logs.
 * @param {Number} [maxAgeDays] Remove any log item older than x days.
 * @return {Promise}
 */
async function _cleanLogs(path, maxAgeDays) {
  const fbPath = path || _logOpts.firebase.fbPath;
  if (!fbPath || !fbPath.startsWith('logs/')) {
    _error(LOG_PREFIX, `cleanLogs() failed - invalid path specified.`, fbPath);
    return false;
  }
  let maxAge = honHelpers.isValidInt(maxAgeDays, 0, Number.MAX_SAFE_INTEGER);
  if (maxAge === null) {
    maxAge = 365;
  }

  const msg = `cleanLogs('${fbPath}', ${maxAge})`;
  _log(LOG_PREFIX, msg);

  let fbRootRef;
  try {
    fbRootRef = await FBHelper.getRootRef(30 * 1000);
  } catch (ex) {
    _exception(LOG_PREFIX `${msg} failed - Unable to get Firebase root`, ex);
    return false;
  }

  const endAt = Date.now() - (1000 * 60 * 60 * 24 * maxAge);
  const niceDate = _formatTime(endAt);
  _debug(LOG_PREFIX, `Removing items older than ${niceDate} from ${fbPath}`);
  const fbRef = await fbRootRef.child(fbPath);

  const itemsSnap = await fbRef.orderByChild('date').endAt(endAt).once('value');
  const numChildren = itemsSnap.numChildren();
  if (numChildren >= 50000) {
    _warn(LOG_PREFIX, `${msg} - may fail, too many items!`);
  }
  _verbose(LOG_PREFIX, `${msg} - found ${numChildren} items`);
  for await (let item of itemsSnap) {
    try {
      await item.ref.remove();
    } catch (ex) {
      log.error(LOG_PREFIX, 'Unable to remove an item', ex);
    }
  }
  // const promises = [];
  // itemsSnap.forEach((item) => {
  //   promises.push(item.ref.remove());
  // });
  // try {
  //   await Promise.all(promises);
  // } catch (ex) {
  //   _exception(LOG_PREFIX, `${msg} - failed to remove some items.`);
  // }
  _debug(LOG_PREFIX, `${msg} - completed, removed ${numChildren} items.`);
  return {path: path, count: numChildren};
}

exports.startWSS = _startWSS;

exports.getOpts = _getOpts;
exports.setConsoleLogOpts = _setConsoleLogOpts;
exports.setFileLogOpts = _setFileLogOpts;
exports.setFirebaseLogOpts = _setFirebaseLogOpts;

exports.formatTime = _formatTime;
exports.humanizeDuration = _humanizeDuration;
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
