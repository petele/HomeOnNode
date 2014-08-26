var log = require("./SystemLog");
var Home = require("./Home");
var Keys = require("./Keys");
var HTTPServer = require("./HTTPServer");


var home = new Home();

var httpServer = new HTTPServer(home);