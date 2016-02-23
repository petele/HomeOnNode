'use strict';

var EventEmitter = require('events').EventEmitter;
var util = require('util');
var diff = require('deep-diff').diff;
var log = require('./SystemLog');
var webRequest = require('./webRequest');
var http = require('http');

function Hue(key, bridgeIP) {
  this.lights = {};
  this.config = {};
  var ready = false;
  var requestTimeout = 7 * 1000;
  var lightRefreshInterval = 3 * 1000;
  var lightRefreshIntervalDefault = 3 * 1000;
  var configRefreshInterval = 7 * 60 * 1000;
  var configRefreshIntervalDefault = 7 * 60 * 1000;
  var self = this;

  this.setLights = function(lights, cmd, callback) {
    if (checkIfReady()) {
      if (Array.isArray(lights) === false) {
        lights = [lights];
      }
      lights.forEach(function(light) {
        var reqPath;
        if (light <= 0) {
          reqPath = '/groups/' + Math.abs(light) + '/action';
        } else {
          reqPath = '/lights/' + light + '/state';
        }
        var msg = '[HUE] ' + reqPath + ' to ' + JSON.stringify(cmd);
        log.log(msg);
        self.makeHueRequest(reqPath, 'PUT', cmd, true, callback);
      });
      return true;
    }
    return false;
  };

  this.setScene = function(sceneId, callback) {
    if (checkIfReady()) {
      var reqPath = '/groups/0/action';
      var cmd = {scene: sceneId};
      var msg = '[HUE] ' + reqPath + ' to ' + JSON.stringify(cmd);
      log.log(msg);
      self.makeHueRequest(reqPath, 'PUT', cmd, true, callback);
      return true;
    }
    return false;
  };

  this.createScene = function(name, lights, callback) {
    if (checkIfReady()) {
      var reqPath = '/scenes/';
      var body = {
        name: name,
        lights: lights,
        appdata: {
          HomeOnNode: true
        }
      };
      self.makeHueRequest(reqPath, 'POST', body, false, callback);
      return true;
    }
    return false;
  };

  this.deleteScene = function(id, callback) {
    if (checkIfReady()) {
      self.makeHueRequest('/scenes/' + id, 'DELETE', null, false, callback);
      return true;
    }
    return false;
  };

  this.createGroup = function(name, lights, callback) {
    if (checkIfReady()) {
      var body = {
        name: name,
        lights: lights
      };
      self.makeHueRequest('/groups', 'POST', body, false, callback);
      return true;
    }
    return false;
  };

  this.deleteGroup = function(id, callback) {
    if (checkIfReady()) {
      self.makeHueRequest('/groups/' + id, 'DELETE', null, false, callback);
      return true;
    }
    return false;
  };

  function checkIfReady() {
    if (ready) {
      return true;
    }
    log.error('[HUE] Hue not ready.');
    return false;
  }

  function monitorLights() {
    setTimeout(function() {
      getLights(function(error, lights) {
        if (error) {
          var msg = '[HUE] Unable to retrieve light state';
          if (lightRefreshInterval < 5 * 60 * 1000) {
            log.error(msg);
            lightRefreshInterval += 5000;
          } else {
            log.exception(msg, error);
            self.emit('error', 'monitor_lights_failed');
          }
        } else {
          if (diff(self.lights, lights)) {
            self.lights = lights;
            self.emit('change', lights);
            lightRefreshInterval = lightRefreshIntervalDefault;
          }
        }
        monitorLights();
      });
    }, lightRefreshInterval);
  }

  function monitorConfig() {
    setTimeout(function() {
      getConfig(function(error, config) {
        if (error) {
          var msg = '[HUE] Unable to retrieve config';
          if (configRefreshInterval < 10 * 60 * 1000) {
            log.error(msg);
            configRefreshInterval += 5000;
          } else {
            log.exception(msg, error);
            self.emit('error', 'monitor_config_failed');
          }
        } else {
          self.config = config;
          self.emit('config', config);
          configRefreshInterval = configRefreshIntervalDefault;
        }
        monitorConfig();
      });
    }, configRefreshInterval);
  }

  function getLights(callback) {
    var reqPath = '/lights';
    self.makeHueRequest(reqPath, 'GET', null, false, callback);
  }

  function getConfig(callback) {
    var reqPath = '';
    self.makeHueRequest(reqPath, 'GET', null, false, callback);
  }

  function findHub(callback) {
    if (bridgeIP) {
      callback();
      return;
    }
    log.log('[HUE] Searching for Hue Hub.');
    var npnpURI = {
      host: 'www.meethue.com',
      path: '/api/nupnp',
      secure: true,
      method: 'GET'
    };
    webRequest.request(npnpURI, null, function(resp) {
      if (Array.isArray(resp) === true && resp.length >= 1) {
        var bridge = resp[0];
        bridgeIP = bridge.internalipaddress;
        log.log('[HUE] Bridge found at ' + bridgeIP);
        callback();
      } else {
        log.error('[HUE] No bridges found, will try again in 2 minutes.');
        self.emit('no_bridge');
        setTimeout(function() {
          findHub();
        }, 2 * 60 * 1000);
      }
    });
  }

  this.makeHueRequest = function(requestPath, method, body, retry, callback) {
    // log.debug('[HUE.request] ' + method + ' ' + requestPath + ' ' + retry);
    var uri = {
      host: bridgeIP,
      path: '/api/' + key + requestPath,
      method: method,
      headers: {}
    };
    if (body && typeof body === 'object') {
      body = JSON.stringify(body);
    }
    if (body) {
      uri.headers['Content-Type'] = 'application/json';
      uri.headers['Content-Length'] = body.length;
    }

    function logErrorInResponse(error) {
      var msg = '[HUE.response] Error in response: ';
      msg += JSON.stringify(error);
      log.error(msg);
    }

    function handleResponse(response) {
      var result = '';
      response.setEncoding('utf8');
      response.on('data', function(chunk) {
        result += chunk;
      });
      response.on('end', function() {
        // var msg = '[HUE.response] ' + method + ' ' + requestPath;
        // log.debug(msg + ' ' + response.statusCode);
        var jsonResult = null;
        var errors = [];

        // Verify status code is 200
        if (response.statusCode !== 200) {
          var scErr = {
            message: 'Status code error',
            expected: 200,
            actual: response.statusCode
          };
          logErrorInResponse(scErr);
          errors.push(scErr);
        }

        // Attempt to convert response to JSON object
        try {
          jsonResult = JSON.parse(result);
        } catch (ex) {
          var jsonErr = {
            message: 'Unable to JSONify response',
            exception: ex,
            actualResponse: result
          };
          log.error('[HUE.response] Unable to JSONify response');
          errors.push(jsonErr);
        }

        // Check if response has an error object
        if (typeof jsonResult === 'object' && jsonResult.error) {
          logErrorInResponse(jsonResult.error);
          errors.push(jsonResult.error);
        }

        // Check if response array has any errors
        if (Array.isArray(jsonResult)) {
          var hasErrors = false;
          jsonResult.forEach(function(r) {
            if (r.error) {
              hasErrors = true;
              logErrorInResponse(r.error);
            }
          });
          if (hasErrors) {
            errors = errors.concat(jsonResult);
          }
        }

        if (errors.length > 0 && retry) {
          self.makeHueRequest(requestPath, method, body, false, callback);
        } else if (errors.length > 0) {
          if (callback) {
            callback(errors, null);
          }
        } else {
          if (callback) {
            callback(null, jsonResult);
          }
        }
      });
    }

    var request = http.request(uri, handleResponse);
    request.on('error', function(error) {
      log.exception('[HUE.request] Request error', error);
      if (retry) {
        self.makeHueRequest(requestPath, method, body, false, callback);
      } else if (callback) {
        callback(error, null);
      }
    });
    request.setTimeout(requestTimeout, function() {
      log.error('[HUE.request] Request timeout exceeded');
      request.abort();
      if (retry) {
        self.makeHueRequest(requestPath, method, body, false, callback);
      } else if (callback) {
        callback('timeout_exceeded', null);
      }
    });
    if (body) {
      request.write(body);
    }
    request.end();
  };

  function init() {
    findHub(function() {
      log.debug('[HUE] Getting initial config.');
      getConfig(function(error, config) {
        if (config && config.config) {
          log.log('[HUE] Ready.');
          self.config = config;
          ready = true;
          self.emit('ready', config);
          monitorConfig();
          monitorLights();
        } else {
          log.error('[HUE] Init failed, will retry in 2 minutes.');
          bridgeIP = null;
          setTimeout(function() {
            init();
          }, 2 * 60 * 1000);
        }
      });
    });
  }

  init();
}

util.inherits(Hue, EventEmitter);

module.exports = Hue;
