'use strict';

var express = require('express');
var path = require('path');
var log = require('./SystemLog');
var methodOverride = require('method-override');
var bodyParser = require('body-parser');

function HTTPServer(config, home, fb) {

  var server;

  this.shutdown = function() {
    if (server) {
      server.close();
      return true;
    } else {
      return false;
    }
  };

  var exp = express();

  log.init('[HTTPServer]');
  var port = config.httpServerPort || 3000;
  exp.set('port', port);
  exp.use(methodOverride());
  exp.use(bodyParser.json());
  exp.use(bodyParser.urlencoded({extended: true}));
  exp.use(bodyParser.text());

  exp.use(function(req, res, next) {
    log.http(req.method, req.path + ' [' + req.ip + ']');
    var body = req.body;
    if (typeof body === 'object') {
      body = JSON.stringify(body);
    }
    if ((body !== '{}') && (body.toString().length > 0)) {
      log.debug('Body: ' + body);
    }
    next();
  });

  exp.get('/favicon.ico', function(req, res) {
    res.sendFile(path.join(__dirname, '/favicon.ico'));
  });

  exp.use('/web/', express.static(path.join(__dirname, 'web')));

  exp.get('/logs/', function(req, res) {
    res.sendFile(path.join(__dirname, '/logs/rpi-system.log'));
  });

  exp.use('/logs/', express.static(path.join(__dirname, 'logs')));

  exp.post('/shutdown', function(req, res) {
    var body = req.body;
    if (typeof body === 'string') {
      body = JSON.parse(body);
    }
    if (body.confirmation === 'shutdown') {
      var timeout = 5000;
      home.shutdown();
      res.send({'shutdown': true, 'timeout': timeout});
      log.appStop('HTTP [' + req.ip + ']');
      setTimeout(function() {
        process.exit();
      }, timeout);
    } else {
      res.send({'shutdown': false});
      log.error('[HTTP] System shutdown attempted, but not confirmed.');
    }
  });

  exp.get('/state', function(req, res) {
    res.send(home.state);
  });

  exp.post('/execute', function(req, res) {
    var body = req.body;
    if (typeof body === 'string') {
      body = JSON.parse(body);
    }
    var sender = '[HTTP ' + req.ip + ']';
    var result = home.executeCommand(body.command, body.modifier, sender);
    res.send(result);
  });

  exp.post('/door', function(req, res) {
    var body = req.body;
    if (typeof body === 'string') {
      body = JSON.parse(body);
    }
    var sender = '[HTTP ' + req.ip + ']';
    var result = home.entryDoor(body.doorName, body.doorState, sender);
    res.send(result);
  });

  exp.post('/temperature', function(req, res) {
    var body = req.body;
    if (typeof body === 'string') {
      body = JSON.parse(body);
    }
    var sender = '[HTTP ' + req.ip + ']';
    var result = home.setTemperature(body.room, body.temperature, sender);
    res.send(result);
  });

  exp.use(function(req, res) {
    res.status(404);
    res.send({error: 'Requested URL not found.'});
    log.error('[HTTP] File not found: ' + req.path + ' [' + req.ip + ']');
  });

  exp.use(function(err, req, res, next) {
    res.status(err.status || 500);
    res.send({error: err.message});
    var msg = '[HTTP] Server Error (' + err.status + ') for: ';
    msg += req.path + ' [' + req.ip + ']';
    log.exception(msg, err);
  });

  server = exp.listen(exp.get('port'), function() {
    log.log('Express server started on port ' + exp.get('port'));
  });
}

module.exports = HTTPServer;
