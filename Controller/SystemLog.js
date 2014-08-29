var fs = require("fs");

var DEBUG = true;
var TO_FIREBASE = false;
var fb;

var file = "./logs/rpi-system.log";

function initFirebase(fbRoot, appName) {
  appName = appName || "default";
  fb = fbRoot.child("logs/" + appName);
  TO_FIREBASE = false;
}

function enableFirebase(enabled) {
  TO_FIREBASE = enabled;
}

function enableDebug(enabled) {
  DEBUG = enabled;
}

function getDateString() {
  var now = new Date();
  var result = now.getFullYear() + "-";
  result += ("00" + (now.getMonth()+1).toString()).slice(-2) + "-";
  result += ("00" + (now.getDate().toString())).slice(-2) + "T";
  result += ("00" + (now.getHours().toString())).slice(-2) + ":";
  result += ("00" + (now.getMinutes().toString())).slice(-2) + ":";
  result += ("00" + (now.getSeconds().toString())).slice(-2) + ".";
  result += ("000" + (now.getMilliseconds().toString())).slice(-3);
  return result;
}

function build(level, message) {
  var msg = getDateString() + " | ";
  msg += ("     " + level).slice(-5) + " | ";
  if (typeof message === "object") {
    message = JSON.stringify(message);
  }
  msg += message;
  return msg;
}

function write(msg) {
  if (fb && TO_FIREBASE) {
    fb.push(msg);
  }
  console.log(msg);
  fs.appendFile(file, msg + "\n");
}

function log(message) {
  write(build("INFO", message));
}

function warn(message) {
  write(build("WARN", message));
}

function error(message) {
  write(build("ERROR", message));
}

function debug(message) {
  if (DEBUG) {
    write(build("DEBUG", message));
  }
}

function init(message) {
  write(build("INIT", message));
}

function http(method, message) {
  write(build(method.toUpperCase(), message));
}

function appStart(appName) {
  var msg = "";
  if (appName) {
    msg += build("START", "") + "\n";
    msg += build("START", appName || "") + "\n";
  } else {
    msg += build("START", "") + "\n";
  }
  msg += build("START", "System Starting") + "\n";
  msg += build("START", "");
  write(msg);
}

function appStop(receivedFrom) {
  var msg = build("STOP", "") + "\n";
  msg += build("STOP", "System Shutting Down")  + "\n";
  if (receivedFrom) {
    msg += build("STOP", " - Stop message received from: " + receivedFrom)  + "\n";
  }
  msg += build("STOP", "");
  write(msg);
}

exports.log = log;
exports.error = error;
exports.debug = debug;
exports.warn = warn;
exports.appStart = appStart;
exports.appStop = appStop;
exports.init = init;
exports.http = http;
exports.level = http;
exports.initFirebase = initFirebase;
exports.enableFirebase = enableFirebase;
exports.enableDebug = enableDebug;
