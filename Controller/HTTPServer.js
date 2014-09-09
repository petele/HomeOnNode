var express = require('express');
var path = require('path');
var log = require("./SystemLog");
var Home = require("./Home");
var Keys = require("./Keys");

var methodOverride = require('method-override');
var bodyParser = require('body-parser');
var multer = require('multer');

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

  fb.child("logs/app").push({"date": Date.now(), "module": "EXPRESS", "state": "STARTING"});

  log.init("[HTTPServer]");

  exp.set('port', config["http-port"]);
  exp.use(methodOverride());
  exp.use(bodyParser.json());
  exp.use(bodyParser.urlencoded({ extended: true }));
  exp.use(multer());
  exp.use(bodyParser.text());

  exp.use(function(req, res, next) {
    log.http(req.method, req.path + " [" + req.ip + "]");
    var body = req.body;
    if (typeof body === "object") {
      body = JSON.stringify(body);
    }
    if ((body !== "{}") && (body.toString().length > 0)) {
      log.debug("Body: " + body);
    }
    next();
  });

  exp.use(express.static("web", path.join(__dirname, 'web')));

  exp.get("/logs/", function(req, res) {
    res.sendFile(path.join(__dirname, "/logs/rpi-system.log"));
  });
  exp.use("/logs/", express.static(path.join(__dirname, "logs")));

  exp.post("/shutdown", function(req, res) {
    var body = req.body;
    if (typeof body === "string") {
      body = JSON.parse(body);
    }
    if (body.confirmation === "shutdown") {
      var timeout = 5000;
      home.shutdown();
      res.send({"shutdown": true, "timeout": timeout});
      log.appStop("HTTP [" + req.ip + "]");
      setTimeout(function() {
        process.exit();
      }, timeout);
    } else {
      res.send({"shutdown": false});
      log.error("Shutdown attempted, but not confirmed.");
    }
  });

  exp.get('/state', function(req, res) {
    res.send(home.state);
  });

  exp.get('/state/:obj', function(req, res) {
    var result = home.state[req.params.obj];
    if (result === undefined) {
      res.status(404);
      res.send({error: "Not found"});
      log.error(req.path + " [" + req.ip + "]");
    } else {
      res.send(result);
    }
  });

  exp.post("/state", function(req, res) {
    var body = req.body;
    if (typeof body === "string") {
      body = JSON.parse(body);
    }
    log.debug("[POST] " + JSON.stringify(body));
    var result = home.set(body.command, body.modifier, "[HTTP " + req.ip + "]");
    res.send(result);
  });

  exp.use(function(req, res){
    res.status(404);
    res.send({ error: "Requested URL not found." });
    log.error(req.path + " [" + req.ip + "]");
  });

  exp.use(function(err, req, res, next) {
    fb.child("logs/app").push({"date": Date.now(), "module": "EXPRESS", "state": "ERROR", "err": err});
    res.status(err.status || 500);
    res.send({ error: err.message });
    log.error(req.path + " [" + req.ip + "] " + err.message);
  });

  server = exp.listen(exp.get('port'), function() {
    fb.child("logs/app").push({"date": Date.now(), "module": "EXPRESS", "state": "READY"});
    log.log("Express server started on port " + exp.get('port'));
  });
}


module.exports = HTTPServer;
