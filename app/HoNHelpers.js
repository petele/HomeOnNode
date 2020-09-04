'use strict';

/* node14_ready */

/**
 * Returns after specified seconds, defaults to 30.
 *
 * @param {Number} [seconds] Number of seconds to wait (optional).
 * @return {?Promise<undefined>} A promise that resolves after specified time.
 */
function _promiseSleep(seconds) {
  seconds = seconds || 30;
  return new Promise((resolve) => {
    setTimeout(resolve, seconds * 1000);
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


exports.promiseSleep = _promiseSleep;
exports.isValidInt = _isValidInt;
