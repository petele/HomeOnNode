var express = require('express');
var path = require('path');
var log = require("./SystemLog");
var Home = require("./Home");
var Keys = require("./Keys");

//var favicon = require('serve-favicon');
//var logger = require('morgan');
var methodOverride = require('method-override');
//var session = require('express-session');
var bodyParser = require('body-parser');
var multer = require('multer');
//var errorHandler = require('errorhandler');

log.appStart();

var server = express();

// all environments
server.set('port', process.env.PORT || 3000);
//server.set('views', path.join(__dirname, 'views'));
//server.set('view engine', 'jade');
//server.use(favicon(__dirname + '/public/favicon.ico'));
//server.use(logger('dev'));
server.use(methodOverride());
//server.use(session({ resave: true, saveUninitialized: true, secret: 'uwotm8' }));
server.use(bodyParser.json());
server.use(bodyParser.urlencoded({ extended: true }));
server.use(multer());
server.use(bodyParser.text());
server.use(express.static(path.join(__dirname, 'web')));

var home = new Home();


// // development only
// if ('development' == server.get('env')) {
//   server.use(errorHandler());
// }

//server.get('/', routes.index);
//server.get('/users', user.list);

server.use("/logs", express.static(path.join(__dirname, "logs")));

server.use(function(req, res, next) {
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

server.post("/shutdown", function(req, res) {
  var body = req.body;
  if (typeof body === "string") {
    body = JSON.parse(body);
  }
  if (body.confirmation === "shutdown") {
    var timeout = 5000;
    home.shutdown();
    res.send({"shutdown": true, "timeout": timeout});
    setTimeout(function() {
      process.exit();
    }, timeout);
  } else {
    res.send({"shutdown": false});
    log.error("Shutdown attempted, but not confirmed.");
  }
});

server.get('/state', function(req, res) {
  res.send(home.state);
});

server.get('/state/:obj', function(req, res) {
  var result = home.state[req.params.obj];
  if (result === undefined) {
    res.status(404);
    res.send({error: "Not found"});
    log.error(req.path + " [" + req.ip + "]");
  } else {
    res.send(result);
  }
});

server.post("/state", function(req, res) {
  var body = req.body;
  if (typeof body === "string") {
    body = JSON.parse(body);
  }
  var result = home.set(body.command, body.options);
  res.send(result);
});

server.use(function(req, res){
  res.status(404);
  res.send({ error: "Requested URL not found." });
  log.error(req.path + " [" + req.ip + "]");
});

server.use(function(err, req, res, next) {
  res.status(err.status || 500);
  res.send({ error: err.message });
  log.error(req.path + " [" + req.ip + "] " + err.message);
});

server.listen(server.get('port'), function() {
  log.log("Express server started on port " + server.get('port'));
});