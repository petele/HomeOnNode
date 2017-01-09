'use strict';

var EventEmitter = require('events').EventEmitter;
var util = require('util');
var log = require('./SystemLog2');

var LOG_PREFIX = 'TEMPLATE';

/**
 * TEMPLATE API
 *
 * @param {string} param1 First Param
 * @param {string} param2 Second Param
 * @return {Object} The Template Object
 */
function Template(param1, param2) {
  var STATE_ENUMS = ['preInit', 'init', 'initFailed',
                     'online', 'ready', 'trouble', 'failed'];
  var _fbRef;
  var _self = this;

  /*****************************************************************************
   * Public Properties and Methods
   ****************************************************************************/
  this.deviceId = 'Template';
  this.deviceState = STATE_ENUMS[0];
  this.templateState = {};

  /**
   * Set Firebase Reference
   *
   * @param {string} path Path to the Firebase object to watch
   */
  this.setFBRef = function(path) {
    if (_fbRef) {
      // TODO: Close the existing Firebase reference
    }
    if (path) {
      // TODO: Setup new Firebase Reference
    }
  };

  /**
   * Initialize the API
   *
   */
  this.init = function() {
    log.init(LOG_PREFIX, 'Init');
    setState(STATE_ENUMS[1]);
    // TODO: Initialize the object
  }

  /**
   * Execute Command - Sends a command to the Hue Hub
   *
   * @param {Array} cmds An array of commands to be executed
   * @return {Promise} The promise with the status of each executed command
   */
  this.executeCommand = function(cmds) {
    if (Array.isArray(cmds) === false) {
      cmds = [cmds];
    }
    var result = [];
    cmds.forEach(function(cmd) {

    });
    return result;
  };

  /*****************************************************************************
   * Private Internal Helper Functions
   ****************************************************************************/
  
  /**
   * Updates the device state and fires an event to let listeners know the
   * state has changed.
   *
   * @param {string} newState The new state to
   * @param {string} msg Message to attach to the event
   * @return {Boolean} True if the state was successfully changed
   */
  function setState(newState, msg) {
    if (_self.deviceState === newState) {
      log.warn(LOG_PREFIX, 'State is already: ' + newState);
      return false;
    }
    if (STATE_ENUMS.indexOf(newState) === -1) {
      log.error(LOG_PREFIX, 'Invalid new state: ' + newState);
      return false;
    }
    _self.deviceState = newState;
    _self.emit('state', newState, msg);
    log.debug(LOG_PREFIX, 'State changed to: ' + newState);
    return true;
  }

  return this;
}

util.inherits(Template, EventEmitter);

module.exports = Template;
