'use strict';

var EventEmitter = require('events').EventEmitter;
var util = require('util');
var diff = require('deep-diff').diff;
var request = require('request');
var log = require('./SystemLog');

// Consider adding queue to API to ensure we don't over extend

function Hue(key, bridgeIP) {
  this.lights = {};
  this.groups = {};
  this.config = {};
  this.requestsInProgress = 0;
  var ready = false;
  var requestTimeout = 3 * 1000;
  var defaultRefreshInterval = 10 * 1000;
  var lightRefreshInterval = defaultRefreshInterval;
  var groupRefreshInterval = defaultRefreshInterval;
  var maxRefreshInterval = 5 * 60 * 1000;
  var defaultConfigRefreshInterval = 7 * 60 * 1000;
  var configRefreshInterval = defaultConfigRefreshInterval;
  var maxConfigRefreshInterval = 10 * 60 * 1000;
  var defaultBackoff = 5 * 1000;
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
        self.makeHueRequest(reqPath, 'PUT', cmd, true, function(error, result) {
          if (!error) {
            updateLights();
            updateGroups();
          }
          if (callback) {
            callback(error, result);
          }
        });
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
      self.makeHueRequest(reqPath, 'PUT', cmd, true, function(error, result) {
        if (!error) {
          updateLights();
          updateGroups();
        }
        if (callback) {
          callback(error, result);
        }
      });
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
      updateLights(function(error, result) {
        if (error && lightRefreshInterval < maxRefreshInterval) {
          lightRefreshInterval += defaultBackoff;
          lightRefreshInterval += Math.floor(Math.random() * 5000);
        } else if (error) {
          // nothing
        } else {
          lightRefreshInterval = defaultRefreshInterval;
          lightRefreshInterval += Math.floor(Math.random() * 750);
        }
        monitorLights();
      });
    }, lightRefreshInterval);
  }

  function monitorGroups() {
    setTimeout(function() {
      updateGroups(function(error, result) {
        if (error && groupRefreshInterval < maxRefreshInterval) {
          groupRefreshInterval += defaultBackoff;
          groupRefreshInterval += Math.floor(Math.random() * 5000);
        } else if (error) {
          // nothing
        } else {
          groupRefreshInterval = defaultRefreshInterval;
          groupRefreshInterval += Math.floor(Math.random() * 2000);
        }
        monitorGroups();
      });
    }, groupRefreshInterval);
  }

  function monitorConfig() {
    setTimeout(function() {
      updateConfig(function(error, result) {
        if (error && configRefreshInterval < maxConfigRefreshInterval) {
          configRefreshInterval += defaultBackoff;
          configRefreshInterval += Math.floor(Math.random() * 10000);
        } else if (error) {
          // nothing
        } else {
          configRefreshInterval = defaultConfigRefreshInterval;
          configRefreshInterval += Math.floor(Math.random() * 15000);
        }
        monitorConfig();
      });
    }, configRefreshInterval);
  }

  function updateGroups(callback) {
    var reqPath = '/groups';
    self.makeHueRequest(reqPath, 'GET', null, false, function(error, groups) {
      if (error) {
        var msg = '[HUE] Unable to retrieve light groups';
        log.exception(msg, error);
      } else if (diff(self.groups, groups)) {
        self.groups = groups;
        self.emit('change_groups', groups);
      }
      if (callback) {
        callback(error, groups);
      }
    });
  }

  function updateLights(callback) {
    var reqPath = '/lights';
    self.makeHueRequest(reqPath, 'GET', null, false, function(error, lights) {
      if (error) {
        var msg = '[HUE] Unable to retrieve lights';
        log.exception(msg, error);
      } else if (diff(self.lights, lights)) {
        self.lights = lights;
        self.emit('change_lights', lights);
      }
      if (callback) {
        callback(error, lights);
      }
    });
  }

  function updateConfig(callback) {
    var reqPath = '';
    self.makeHueRequest(reqPath, 'GET', null, false, function(error, config) {
      if (error) {
        var msg = '[HUE] Unable to retrieve config';
        log.exception(msg, error);
      } else {
        self.config = config;
        self.emit('config', config);
      }
      if (callback) {
        callback(error, config);
      }
    });
  }

  function findHub(callback) {
    if (bridgeIP) {
      callback();
      return;
    }
    log.log('[HUE] Searching for Hue Hub.');
     var nupnp = {
      url: 'https://www.meethue.com/api/nupnp',
      method: 'GET',
      json: true
    };
    request(nupnp, function(err, resp, body) {
      if (err) {
        log.exception('[HUE] NUPNP Search failed', err);
      } else if (resp && resp.statusCode !== 200) {
        log.error('[HUE] NUPNP Search failed, status code:' + resp.statusCode);
      } else if (Array.isArray(body) === false) {
        log.error('[HUE] NUPNP Search failed, no array returned.');
      } else if (body.length === 0) {
        log.error('[HUE] NUPNP Search failed, no hubs found.');
      } else if (body[0].internalipaddress) {
        bridgeIP = body[0].internalipaddress;
        log.log('[HUE] NUPNP Search completed, bridge at ' + bridgeIP);
        if (callback) {
          callback(bridgeIP);
        }
        return;
      }
      log.error('[HUE] No bridge found, will retry in 2 minutes.');
      self.emit('no_bridge');
      setTimeout(function() {
        findHub();
      }, 2 * 60 * 1000);
    });
  }

  this.makeHueRequest = function(requestPath, method, body, retry, callback) {
    self.requestsInProgress += 1;
    if (self.requestsInProgress >= 5) {
      var warnMsg = '[HUE] Excessive requests in progress: ';
      warnMsg += ' ' + self.requestsInProgress;
      log.warn(warnMsg);
    }

    var requestOptions = {
      uri: 'http://' + bridgeIP + '/api/' + key + requestPath,
      method: method,
      json: true,
      timeout: requestTimeout,
      agentOptions: { keepAlive: false, maxSockets: 2 }
    };
    if (body) {
      requestOptions.body = body;
    }
    request(requestOptions, function(error, response, respBody) {
      self.requestsInProgress -= 1;
      var msg = '[HUE] makeHueRequest ';
      var errors = [];
      if (error) {
        log.exception(msg + 'Error', error);
        errors.push(error);
      }
      if (response && response.statusCode !== 200) {
        log.error(msg + 'Bad statusCode: ' + response.statusCode);
        errors.push({statusCode: response.statusCode});
      }
      if (response && response.headers['content-type'] !== 'application/json') {
        var contentType = response.headers['content-type'];
        log.error(msg + 'Invalid content type: ' + contentType);
        errors.push({contentType: contentType});
      }
      if (respBody && respBody.error) {
        log.error(msg + 'Response error: ' + respBody);
        errors.push(respBody.error);
      }
      if (respBody && Array.isArray(respBody)) {
        var hasErrors = false;
        respBody.forEach(function(item) {
          if (item.error) {
            hasErrors = true;
            log.error(msg + 'Response error: ' + JSON.stringify(item));
          }
        });
        if (hasErrors) {
          errors = errors.concat(respBody);
        }
      }

      if (errors.length > 0 && retry) {
        self.makeHueRequest(requestPath, method, body, false, callback);
      } else if (callback) {
        if (errors.length === 0) {
          errors = null;
        }
        callback(errors, respBody);
      }
    });
  };

  function init() {
    findHub(function() {
      log.debug('[HUE] Getting initial config.');
      updateConfig(function(error, config) {
        if (config && config.config) {
          log.log('[HUE] Ready.');
          ready = true;
          self.emit('ready', config);
          monitorConfig();
          monitorLights();
          monitorGroups();
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
