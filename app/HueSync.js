'use strict';

const util = require('util');
// const fetch = require('node-fetch');
// const log = require('./SystemLog2');
// const honHelpers = require('./HoNHelpers');
const EventEmitter = require('events').EventEmitter;

// const LOG_PREFIX = 'HUE_SYNC';

/**
 * Philips Hue Sync API.
 * @constructor
 *
 * @fires Hue#config_changed
 * @param {String} key Hue authentication key.
 * @param {String} ipAddress IP Address of the Hub
 */
function HueSync(key, ipAddress) {
}

util.inherits(HueSync, EventEmitter);

module.exports = HueSync;
