'use strict';

var EventEmitter = require('events').EventEmitter;
var util = require('util');
var diff = require('deep-diff').diff;
var request = require('request');
var log = require('./SystemLog2');

// Consider adding queue to API to ensure we don't over extend

var LOG_PREFIX = 'NANOLEAF';

function NanoLeaf(key, ip, port) {
  this.state = {};
  var hubAddress;
  var ready = false;
  var requestTimeout = 45 * 1000;
  var self = this;

  // Turn on/off PUT /api/beta/auth_token/state {"on": true}
  this.setPower = function(turnOn) {
    log.info(LOG_PREFIX, `setPower[${turnOn}]`);
    return new Promise(function(resolve, reject) {
      if (checkIfReady() === false) {
        reject('not_ready');
        return;
      }
      let body = {on: turnOn};
      resolve(makeLeafRequest('state', 'PUT', body));
    });
  };

  // Set effect PUT /api/beta/auth_token/effects {"select": "Pete1"}
  this.setEffect = function(effectName) {
    log.info(LOG_PREFIX, `setEffect[${effectName}]`);
    if (effectName === 'OFF') {
      return self.setPower(false);
    }
    return new Promise(function(resolve, reject) {
      if (checkIfReady() === false) {
        reject('not_ready');
        return;
      }
      let body = {
        select: effectName
      };
      resolve(makeLeafRequest('effects', 'PUT', body));
    });

  };

  // Set brightness PUT /api/beta/auth_token/state {"brightness": 100} 0-100
  this.setBrightness = function(level) {
    log.info(LOG_PREFIX, `setBrightness()[${level}]`);
    return new Promise(function(resolve, reject) {
      if (checkIfReady() === false) {
        reject('not_ready');
        return;
      }
      let body = {brightness: getBrightness(level)};
      resolve(makeLeafRequest('state', 'PUT', body));
    });
  };

  function getBrightness(level) {
    if (level) {
      try {
        let bri = parseInt(level, 10);
        if (bri >= 1 && bri <= 100) {
          return bri;
        } else {
          log.error(LOG_PREFIX, 'Brightness out of range.');
        }
      } catch (ex) {
        log.error(LOG_PREFIX, 'Brightness must be an integer.');
      }
    }
    return 25;
  }

  function checkIfReady() {
    if (ready) {
      return true;
    }
    log.error(LOG_PREFIX, 'NanoLeaf not ready.');
    return false;
  }

  function monitorLeaf() {
    log.debug(LOG_PREFIX, `Starting monitorLeaf...`);
    setInterval(getState, requestTimeout);
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
        if (ready === false) {
          ready = true;
          eventName = 'ready';
        }
        self.emit(eventName, resp);
      }
      return resp;
    });
  }

  function makeLeafRequest(requestPath, method, body) {
    // log.debug(LOG_PREFIX, `makeLeafRequest[${method}, ${requestPath}]`, body);
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
          return;
        }
        if (response && response.statusCode !== 200) {
          reject(new Error('Bad statusCode: ' + response.statusCode));
          return;
        }
        if (respBody && respBody.error) {
          reject(new Error('Response Error: ' + respBody));
          return;
        }
        if (requestPath !== '') {
          getState();
        }
        resolve(respBody);
      });    
    });
  }

  function findHub() {
    return new Promise(function(resolve, reject) {
      if (ip && port) {
        resolve({ip: ip, port: port});
        return;
      }
      log.error(LOG_PREFIX, 'findHub NYI');
      reject();
    });
  }

  function init() {
    log.init(LOG_PREFIX, 'Starting NanoLeaf...');
    findHub()
    .then(function(hubInfo) {
      log.log(LOG_PREFIX, `Hub found at ${hubInfo.ip}:${hubInfo.port}`);
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
