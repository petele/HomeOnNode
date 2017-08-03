'use strict';

const express = require('express');
const path = require('path');
const log = require('./SystemLog2');
const methodOverride = require('method-override');
const bodyParser = require('body-parser');
const EventEmitter = require('events').EventEmitter;
const util = require('util');

const LOG_PREFIX = 'HTTPRequest';
const PORT = 3000;

/**
 * Starts the local HTTP server.
 * @constructor
*/
function HTTPServer() {
  let server;
  const _self = this;

  this.shutdown = function() {
    if (server) {
      server.close();
      return true;
    } else {
      return false;
    }
  };

  const exp = express();

  log.init(LOG_PREFIX, `Starting HTTP Server on port :${PORT}...`);
  exp.set('port', PORT);
  exp.use(methodOverride());
  exp.use(bodyParser.json());
  exp.use(bodyParser.urlencoded({extended: true}));
  exp.use(bodyParser.text());

  exp.use(function(req, res, next) {
    const msg = req.method + ' ' + req.path + ' from ' + req.ip;
    let body = req.body;
    if (Object.keys(body).length === 0) {
      body = null;
    }
    log.debug(LOG_PREFIX, msg, body);
    next();
  });

  exp.get('/favicon.ico', function(req, res) {
    res.sendFile(path.join(__dirname, '/web/favicon.ico'));
  });

  exp.post('/execute/name', function(req, res) {
    let body = req.body;
    if (typeof body === 'string') {
      body = JSON.parse(body);
    }
    const sender = '[HTTP ' + req.ip + ']';
    _self.emit('executeCommandByName', body.cmdName, body.modifier, sender);
    res.send({result: 'done'});
  });

  exp.post('/execute', function(req, res) {
    let body = req.body;
    if (typeof body === 'string') {
      body = JSON.parse(body);
    }
    const sender = '[HTTP ' + req.ip + ']';
    _self.emit('executeCommand', body, sender);
    res.send({result: 'done'});
  });

  exp.post('/doorbell', function(req, res) {
    const sender = '[HTTP ' + req.ip + ']';
    _self.emit('doorbell', sender);
    res.send({result: 'done'});
  });

  exp.use(function(req, res) {
    res.status(404);
    res.send({error: 'Requested URL not found.'});
    log.error(LOG_PREFIX, 'File not found: ' + req.path + ' [' + req.ip + ']');
  });

  exp.use(function(err, req, res, next) {
    res.status(err.status || 500);
    res.send({error: err.message});
    let msg = 'Server Error (' + err.status + ') for: ';
    msg += req.path + ' [' + req.ip + ']';
    log.exception(LOG_PREFIX, msg, err);
  });

  server = exp.listen(exp.get('port'), function() {
    log.log(LOG_PREFIX, 'Express server started on port ' + exp.get('port'));
  });
}
util.inherits(HTTPServer, EventEmitter);

module.exports = HTTPServer;
