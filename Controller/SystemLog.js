var fs = require("fs");
var DEBUG = true;
var file = "./logs/rpi-system.log";

function build(level, message) {
  var msg = new Date().toISOString() + " | ";
  msg += ("     " + level).slice(-5) + " | ";
  if (typeof message === "object") {
    message = JSON.stringify(message);
  }
  msg += message;
  return msg;
}

function write(msg) {
  console.log(msg);
  fs.appendFile(file, msg + "\n");
}

function log(message) {
  write(build("INFO", message));
}

function error(message) {
  write(build("ERROR", message));
}

function debug(message) {
  if (process.env.HOMEDEBUG || false || DEBUG) {
    write(build("DEBUG", message));
  }
}

function init(message) {
  write(build("INIT", message));
}

function http(method, message) {
  write(build(method.toUpperCase(), message));
}

function appStart() {
  var msg = "                         | ***** |\n";
  msg += build("START", "System Starting");
  write(msg);
}

exports.log = log;
exports.error = error;
exports.debug = debug;
exports.appStart = appStart;
exports.init = init;
exports.http = http;