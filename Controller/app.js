var express = require('express');
var path = require('path');
var log = require("./SystemLog");
var Home = require("./Home");

var favicon = require('serve-favicon');
//var logger = require('morgan');
var methodOverride = require('method-override');
var session = require('express-session');
var bodyParser = require('body-parser');
var multer = require('multer');
//var errorHandler = require('errorhandler');


log.appStart();

var app = express();

// all environments
app.set('port', process.env.PORT || 3000);
//app.set('views', path.join(__dirname, 'views'));
//app.set('view engine', 'jade');
//app.use(favicon(__dirname + '/public/favicon.ico'));
//app.use(logger('dev'));
app.use(methodOverride());
//app.use(session({ resave: true, saveUninitialized: true, secret: 'uwotm8' }));
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(multer());
app.use(bodyParser.text());
app.use(express.static(path.join(__dirname, 'web')));




var home = new Home();


// // development only
// if ('development' == app.get('env')) {
//   app.use(errorHandler());
// }

//app.get('/', routes.index);
//app.get('/users', user.list);

app.use(function(req, res, next) {
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

app.post("/shutdown", function(req, res) {
  var body = req.body;
  if (typeof body === "string") {
    body = JSON.parse(body);
  }
  if (body.confirmation === "shutdown") {
    var timeout = 5000;
    res.send({"shutdown": true, "timeout": timeout});
    setTimeout(function() {
      process.exit();
    }, timeout);
  } else {
    res.send({"shutdown": false});
    log.error("Shutdown attempted, but not confirmed.");
  }
});

app.get('/state', function(req, res) {
  res.send(home.state);
});

app.get('/state/:obj', function(req, res) {
  var result = home.state[req.params.obj];
  if (result === undefined) {
    res.status(404);
    res.send({error: "Not found"});
    log.error(req.path + " [" + req.ip + "]");
  } else {
    res.send(result);
  }
});

app.post("/state", function(req, res) {
  var body = req.body;
  if (typeof body === "string") {
    body = JSON.parse(body);
  }
  var result = home.set(body.command, body.options);
  res.send(result);
});

app.use(function(req, res){
  res.status(404);
  res.send({ error: "Requested URL not found." });
  log.error(req.path + " [" + req.ip + "]");
});

app.use(function(err, req, res, next) {
  res.status(err.status || 500);
  res.send({ error: err.message });
  log.error(req.path + " [" + req.ip + "] " + err.message);
});



app.listen(app.get('port'), function() {
  log.log("Express server started on port " + app.get('port'));
});