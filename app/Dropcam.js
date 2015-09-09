'use strict';

var EventEmitter = require('events').EventEmitter;
var util = require('util');
var https = require('https');
var log = require('./SystemLog');
var diff = require('deep-diff').diff;

function Dropcam(username, password) {
  var self = this;
  var authToken;
  this.cameras = [];
  this.refreshInterval = 1;
  this.defaultRefreshInterval = 20000;

  function makeRequest(options, body, callback) {
    var request;
    options.hostname = 'www.dropcam.com';
    options.headers = {
      'Referer': 'https://www.dropcam.com'
    };
    if (authToken) {
      options.headers.Cookie = authToken;
    }
    if (body) {
      options.headers['Content-Type'] = 'application/x-www-form-urlencoded';
      options.headers['Content-Length'] = body.length;
    }
    function handleResponse(response) {
      var result = '';
      response.setEncoding('utf8');
      response.on('data', function(chunk) {
        result += chunk;
      });
      response.on('end', function() {
        if (callback) {
          try {
            result = JSON.parse(result);
            if (result.status === 403) {
              getAuthToken();
              callback(403, result);
            } else {
              callback(response.statusCode, result);
            }
          } catch (ex) {
            log.exception('[DROPCAM] Error parsing result', ex);
            callback(-1, ex);
          }
        }
      });
    }
    request = https.request(options, handleResponse);
    request.on('error', function(err) {
      log.error('[DROPCAM] Error on request: ' + err.toString());
      if (callback) {
        callback(-1, err);
      }
    });
    if (body) {
      request.write(body);
    }
    request.end();
  }

  function getAuthToken(callback) {
    var body = 'username=[[USERNAME]]&password=[[PASSWORD]]';
    body = body.replace('[[USERNAME]]', username);
    body = body.replace('[[PASSWORD]]', password);
    var uri = {
      method: 'POST',
      path: '/api/v1/login.login',
    };
    makeRequest(uri, body, function(respCode, resp) {
      if ((respCode === 200) && (resp.status === 0)) {
        authToken = 'website_2=' + resp.items[0].session_token + ';'; // jshint ignore:line
        log.debug('[DROPCAM] AuthToken: ' + authToken);
        if (callback) {
          callback(null, true);
        }
      } else if (callback) {
        var msg = '[DROPCAM.getAuthToken] HTTP Response Code: ' + respCode;
        log.exception(msg, resp);
        callback(respCode, false);
      }
    });
  }

  this.getCameras = function(callback) {
    var uri = {
      method: 'GET',
      path: '/api/v1/cameras.get_visible',
    };
    makeRequest(uri, null, function(respCode, resp) {
      if ((respCode === 200) && (callback)) {
        if (resp.status === 0) {
          log.log('[DROPCAM] Found ' + resp.items.length + ' Dropcams');
          callback(null, resp.items);
        } else {
          log.exception('[DROPCAM.getCameras]', resp);
          callback(respCode, null);
        }
      } else if (callback) {
        var msg = '[DROPCAM.getCameras] HTTP Response Code: ' + respCode;
        log.exception(msg, resp);
        callback(respCode, null);
      }
    });
  };

  this.getCamera = function(uuid, callback) {
    var uri = {
      method: 'GET',
      path: '/api/v1/dropcams.get_properties?uuid=' + uuid
    };
    log.debug('[DROPCAM] Getting Dropcam properties for Dropcam: ' + uuid);
    makeRequest(uri, null, function(respCode, resp) {
      if ((respCode === 200) && (callback)) {
        if (resp.status === 0) {
          callback(null, resp.items[0]);
        } else {
          log.exception('[DROPCAM.getCamera]', resp);
          callback(respCode, null);
        }
      } else if (callback) {
        var msg = '[DROPCAM.getCamera] HTTP Response Code: ' + respCode;
        log.error(msg, resp);
        callback(respCode, null);
      }
    });
  };

  // TODO: fix this!
  this.enableCamera = function(uuid, enabled, callback) {
    var body = 'uuid=[[UUID]]&key=streaming.enabled&value=[[ENABLED]]';
    body = body.replace('[[UUID]]', uuid);
    body = body.replace('[[ENABLED]]', enabled.toString());
    var uri = {
      method: 'POST',
      path: '/api/v1/dropcams.set_property',
    };
    log.log('[DROPCAM] Enabled: ' + enabled.toString());
    makeRequest(uri, body, function(respCode, resp) {
      if ((respCode === 200) && (callback)) {
        if (resp.status === 0) {
          callback(null, resp.items[0]);
        } else {
          log.error('[DROPCAM.enableCamera]', resp);
          callback(respCode, null);
        }
      } else if (callback) {
        var msg = '[DROPCAM.enableCamera] HTTP Response Code: ' + respCode;
        log.error(msg, resp);
        callback(respCode, null);
      }
    });
  };

  function monitorDropcams() {
    setTimeout(function() {
      self.getCameras(function(err, cams) {
        if (err) {
          log.exception('[DROPCAM.monitorDropcams]', err);
          self.emit('error', err);
          if (self.refreshInterval < self.defaultRefreshInterval * 5) {
            self.refreshInterval += 5000;
          } else {
            log.error('[Dropcams] Exceeded maximum timeout, throwing error.');
            self.emit('error');
          }
        } else {
          var differences = diff(self.cameras, cams);
          if (differences) {
            log.debug('[DROPCAM] Cameras properties changed.');
            self.cameras = cams || [];
            self.emit('change', cams);
          }
          self.refreshInterval = self.defaultRefreshInterval;
        }
      });
    }, self.refreshInterval);
  }

  function init() {
    log.init('[DROPCAM]');
    getAuthToken(function(err, authenticated) {
      if (err) {
        log.exception('[DROMCAM] Error getting auth token', err);
        self.emit('authError', err);
      } else {
        self.getCameras(function(err, cams) {
          if (err) {
            log.exception('[DROPCAM] Error getting cameras', err);
            self.cameras = [];
            self.emit('error', err);
          } else {
            self.cameras = cams;
            log.log('[DROPCAM] Ready.');
            self.emit('ready', cams);
            monitorDropcams();
          }
        });
      }
    });
  }

  init();
}

util.inherits(Dropcam, EventEmitter);

module.exports = Dropcam;
