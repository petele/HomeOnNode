'use strict';

var EventEmitter = require('events').EventEmitter;
var util = require('util');
var diff = require('deep-diff').diff;
var request = require('request');
var log = require('./SystemLog2');

// Consider adding queue to API to ensure we don't over extend

var LOG_PREFIX = 'NANOLEAF';

function NanoLeaf(key) {
  this.state = {};
  var hubAddress;
  var ready = false;
  var requestTimeout = 15 * 1000;
  var self = this;

  // Turn on/off PUT /api/beta/auth_token/state {"on": true}
  this.setPower = function(turnOn) {
    log.debug(LOG_PREFIX, `setPower[${turnOn}]`);
    return new Promise(function(resolve, reject) {
      if (checkIfReady() === false) {
        reject('not_ready');
      }
      let body = {on: turnOn};
      resolve(makeLeafRequest('state', 'PUT', body));
    });
  };

  // Set effect PUT /api/beta/auth_token/effects {"select": "Pete1"}
  this.setEffect = function(effectName) {
    log.debug(LOG_PREFIX, `setEffect[${effectName}]`);
    if (effectName === 'OFF') {
      return setPower(false);
    }
    return new Promise(function(resolve, reject) {
      if (checkIfReady() === false) {
        reject('not_ready');
      }
      let body = {select: effectName};
      resolve(makeLeafRequest('effects', 'PUT', body));
    });

  };

  // Set brightness PUT /api/beta/auth_token/state {"brightness": 100} 0-100
  this.setBrightness = function(level) {
    log.debug(LOG_PREFIX, `setBrightness()[${level}]`);
    return new Promise(function(resolve, reject) {
      if (checkIfReady() === false) {
        reject('not_ready');
      }
      let bri;
      try {
        bri = parseInt(level, 10);
      } catch (ex) {
        log.error(LOG_PREFIX, 'setBrightness level must be an integer.');
        reject('level must be an integer.');
      }
      if (bri >= 0 && bri <= 100) {
        let body = {brightness: bri};
        resolve(makeLeafRequest('state', 'PUT', body));
      }
      log.error(LOG_PREFIX, 'setBrightness level out of range.');
      reject('Brightness out of range');
    });
  };

  function checkIfReady() {
    if (ready) {
      return true;
    }
    log.error(LOG_PREFIX, 'NanoLeaf not ready.');
    return false;
  }

  function monitorLeaf() {
    log.debug(LOG_PREFIX, `Starting monitorLeaf...`);
    setTimeout(getState, requestTimeout);
  }

  // Get all info GET /api/beta/auth_token/
  function getState() {
    return makeLeafRequest('', 'GET', null)
    .catch(function(err) {
      log.error(LOG_PREFIX, err.message);
    })
    .then(function(resp) {
      // Has the state changed since last time?
      if (diff(self.state, resp)) {
        self.state = resp;
        var eventName = 'state';
        // If we weren't ready before, change to ready & fire ready event
        if (self.ready === false) {
          self.ready = true;
          eventName = 'ready';
        }
        self.emit(eventName, resp);
      }
      return resp;
    });
  }


  function makeLeafRequest(requestPath, method, body) {
    log.debug(LOG_PREFIX, `makeLeafRequest[${method}, ${requestPath}, ${body}]`);
    return new Promise(function(resolve, reject) {
      var requestOptions = {
        uri: hubAddress + requestPath,
        method: method,
        json: true,
        agent: false
      };
      if (body) {
        requestOptions.body = body;
      }

      request(requestOptions, function(error, response, respBody) {
        if (error) {
          reject(error);
        }
        if (response && response.statusCode !== 200) {
          reject(new Error('Bad statusCode: ' + response.statusCode));
        }
        if (respBody && respBody.error) {
          reject(new Error('Response Error: ' + respBody));
        }
        if (requestPath === '') {
          getState();
        }
        resolve(respBody);
      });    
    });
  }

  function findHub() {
    return new Promise(function(resolve, reject) {
      log.debug(LOG_PREFIX, 'Searching for hub...');
      resolve({ip: '192.168.1.28', port: 1900});
    });
  }

  function init() {
    log.init(LOG_PREFIX, 'Starting NanoLeaf...');
    findHub()
    .then(function(hubInfo) {
      log.debug(LOG_PREFIX, '')
      hubAddress = `http://${hubInfo.ip}:${hubInfo.port}/api/beta/${key}/`;
      return hubAddress;
    })
    .then(getState)
    .then(function(state) {
      monitorLeaf();
    });
  }

  init();
}

util.inherits(NanoLeaf, EventEmitter);

module.exports = NanoLeaf;
