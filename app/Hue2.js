'use strict';

var EventEmitter = require('events').EventEmitter;
var util = require('util');
var diff = require('deep-diff').diff;
var request = require('request');
var log = require('./SystemLog2');

var LOG_PREFIX = 'HUE';

function Hue(address, credentials) {
  var deviceAddress = address;
  var deviceCredentials = credentials
  var STATE_ENUMS = ['preInit', 'init', 'initFailed',
                     'online', 'ready', 'troubled', 'failed'];
  this.deviceId = 'HUEBridge';
  this.deviceName = 'HUE Bridge';
  this.deviceState = STATE_ENUMS[0];
  this.hueState = {}
  var self = this;
  
  this.init = function() {
    log.init(LOG_PREFIX, 'Init');
    setState(STATE_ENUMS[1]);
    log.debug(LOG_PREFIX, 'Getting initial config.');
    refreshConfig(function(error, config) {
      if (error) {
        log.error(LOG_PREFIX, 'Unable to connect to Hue Hub', error);
        setState(STATE_ENUMS[2]);
        return;
      }
      self.hueState.onlineAt = Date.now();
      self.hueState.config = config;
      setState(STATE_ENUMS[3]);
    });
        
  }
  this.executeCommand = function(opts) {};
  this.getState = function() {
    return self.hueState;
  };
  this.updateSettings = function(opts) {};
  this.useFirebase = function(fbRoot) {};

  function refreshConfig(callback) {
    var reqPath = '';
    self.makeHueRequest(reqPath, 'GET', null, false, callback); 
  };


}