'use strict';

const path = require('path');
const util = require('util');
const express = require('express');
const log = require('./SystemLog2');
const bodyParser = require('body-parser');
const methodOverride = require('method-override');
const EventEmitter = require('events').EventEmitter;

const LOG_PREFIX = 'HTTP_SERVER';

/**
 * Starts the local HTTP server.
 * @constructor
 *
 * @param {Number} [port] The port to listen on, defaults to 3000.
*/
function HTTPServer(port) {
  let server;
  const _port = port || 3000;
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

  log.init(LOG_PREFIX, 'Starting...', {port: _port});
  exp.set('port', _port);
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

  exp.get('/sounds/:fileName', function(req, res) {
    const fileName = req.params.fileName;
    const opts = {
      root: path.join(__dirname, 'sounds'),
    };
    res.sendFile(fileName, opts, (err) => {
      if (err) {
        log.error(LOG_PREFIX, `Sending sound file failed: ${fileName}`, err);
        res.status(404);
        res.send('Requested URL not found.');
      }
    });
  });

  exp.post('/execute/name', function(req, res) {
    let body = req.body;
    if (typeof body === 'string') {
      body = JSON.parse(body);
    }
    const sender = '[HTTP ' + req.ip + ']';
    _self.emit('executeCommandByName', body.cmdName, sender);
    res.send({result: 'done'});
  });

  exp.post('/execute/actions', function(req, res) {
    let body = req.body;
    if (typeof body === 'string') {
      body = JSON.parse(body);
    }
    const sender = '[HTTP ' + req.ip + ']';
    _self.emit('executeActions', body.actions, sender);
    res.send({result: 'done'});
  });

  exp.post('/execute', function(req, res) {
    let body = req.body;
    if (typeof body === 'string') {
      body = JSON.parse(body);
    }
    const sender = '[HTTP ' + req.ip + ']';
    const msg = `executeCommand not supported anymore. From: ${sender}`;
    log.error(LOG_PREFIX, msg, body);
    res.send({result: 'failed'});
  });

  exp.post('/doorbell', function(req, res) {
    const sender = '[HTTP ' + req.ip + ']';
    const body = {doorbell: true};
    _self.emit('executeActions', body, sender);
    res.send({result: 'done'});
    log.warn(LOG_PREFIX, `Deprecated path '/doorbell' hit`);
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
    log.debug(LOG_PREFIX, 'Express server started on port ' + exp.get('port'));
  });
}
util.inherits(HTTPServer, EventEmitter);

module.exports = HTTPServer;
