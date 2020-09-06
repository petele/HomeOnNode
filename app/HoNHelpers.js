'use strict';

/* node14_ready */

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


exports.sleep = _sleep;
exports.isValidInt = _isValidInt;
