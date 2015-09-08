'use strict';

var http = require('http');
var https = require('https');
var log = require('./SystemLog');

function makeRequest(uri, body, callback) {
  var request;
  var options = {
    hostname: uri.host,
    path: uri.path,
    headers: {}
  };
  if (uri.port) {
    options.port = uri.port;
  }
  if (uri.method) {
    options.method = uri.method;
  }
  if (body) {
    options.headers['Content-Type'] = 'application/json';
    options.headers['Content-Length'] = body.length;
  }
  if (uri.authorization) {
    options.headers['Authorization'] = uri.authorization; // jshint ignore:line
  }

  function handleResponse(response) {
    var result = '';
    response.setEncoding('utf8');
    response.on('data', function(chunk) {
      result += chunk;
    });
    response.on('end', function() {
      log.debug('[WebRequest] Response: ' + result);
      if (callback) {
        try {
          callback(JSON.parse(result));
        } catch (ex) {
          log.exception('[WebRequest] Response Error: ', ex);
          callback({'error': ex});
        }
      }
    });
  }

  log.debug('[WebRequest] Request: ' + JSON.stringify(options));
  if (uri.secure) {
    request = https.request(options, handleResponse);
  } else {
    request = http.request(options, handleResponse);
  }
  request.on('error', function(error) {
    log.error('[WebRequest] Request Error: ' + error);
    if (callback) {
      callback({'error': error});
    }
  });
  request.setTimeout(2500, function() {
    log.warn('[WebRequest] Timeout Exceeded');
    request.abort();
  });
  if (body) {
    request.write(body);
    log.debug('[WebRequest] Body: ' + body);
  }
  request.end();
}

exports.request = makeRequest;
