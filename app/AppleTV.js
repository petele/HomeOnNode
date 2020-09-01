'use strict';

const util = require('util');
const log = require('./SystemLog2');
// const diff = require('deep-diff').diff;
const EventEmitter = require('events').EventEmitter;
// const appleTV = require('node-appletv-x');

const LOG_PREFIX = 'APPLE_TV';

/**
 * AppleTV API.
 * @constructor
 *
 * @see https://github.com/evandcoleman/node-appletv
 *
 * @param {Object} credentials login credentials.
*/
function AppleTV(credentials) {
  // let _ready = false;
  // const _self = this;

  /**
   * Init
   */
  function _init() {
    log.init(LOG_PREFIX, 'Starting...');
    if (!credentials) {
      log.error(LOG_PREFIX, 'Not credentials provided, aborting...');
      return;
    }
  }

  /**
   * Executes an AppleTV command
   *
   * @param {Object} command Command to execute.
   * @return {Object} result of executed command
   */
  this.execute = function(command) {
    return {success: false};
  };

  _init();
}

util.inherits(AppleTV, EventEmitter);

module.exports = AppleTV;
