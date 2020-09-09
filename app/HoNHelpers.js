'use strict';

/* node14_ready */

const os = require('os');
const net = require('net');

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

/**
 * Pings a device to see if it's alive and the specified port is open.
 *
 * @param {String} ipAddress
 * @param {Number} port
 * @return {Promise<Boolean>} Is the server alive.
 */
function _isAlive(ipAddress, port) {
  return new Promise((resolve) => {
    const s = new net.Socket();
    s.connect(port, ipAddress, () => {
      s.destroy();
      resolve(true);
    });
    s.on('error', (err) => {
      s.destroy();
      resolve(false);
    });
    s.setTimeout(1500, () => {
      s.destroy();
      resolve(false);
    });
  });
}

/**
 * Waits for the device to respond on the specified ip/port.
 *
 * @param {String} ipAddress
 * @param {Number} port
 * @return {Promise<Boolean>} Returns true when it's alive.
 */
async function _waitForAlive(ipAddress, port) {
  const alive = await _isAlive(ipAddress, port);
  if (alive) {
    return true;
  }
  await _sleep(30 * 1000);
  return await _waitForAlive(ipAddress, port);
}


exports.getHostname = _getHostname;
exports.isAlive = _isAlive;
exports.isValidInt = _isValidInt;
exports.sleep = _sleep;
exports.waitForAlive = _waitForAlive;
