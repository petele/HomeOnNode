'use strict';

/* node14_ready */

const os = require('os');

/**
 * Returns after specified seconds, defaults to 30,000.
 *
 * @param {Number} [ms] Number of milliseconds to wait (optional).
 * @return {?Promise<undefined>} A promise that resolves after specified time.
 */
function _sleep(ms) {
  if (ms === null || ms === undefined) {
    ms = 30 * 1000;
  }
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/**
 * Checks if the input is a valid integer between min and max.
 *
 * @param {*} val
 * @param {Number} min
 * @param {Number} max
 * @return {?Number} Value, or null if invalid.
 */
function _isValidInt(val, min, max) {
  val = parseInt(val);
  if (!Number.isInteger(val)) {
    return null;
  }
  if (val > max) {
    return null;
  }
  if (val < min) {
    return null;
  }
  return val;
}

/**
 * Gets the simple hostname
 *
 * @return {String} hostname
 */
function _getHostname() {
  const hostname = os.hostname();
  if (!hostname.includes('.')) {
    return hostname;
  }
  return hostname.substring(0, hostname.indexOf('.'));
}


exports.sleep = _sleep;
exports.getHostname = _getHostname;
exports.isValidInt = _isValidInt;
