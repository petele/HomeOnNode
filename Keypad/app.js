var keypress = require("keypress");
var fs = require("fs");
var sendCommand = require("./sendCommand");
var log = require("./SystemLog");
//var Firebase = require("firebase");
var fbHelper = require("./fbHelper");
var Keys = require("./Keys");


var config;
var modifier;

log.appStart("KeyPad");

function listen() {
  // make `process.stdin` begin emitting "keypress" events
  keypress(process.stdin);

  // listen for the "keypress" event
  process.stdin.on('keypress', function (ch, key) {
    if ((key && key.ctrl && key.name === 'c') || (ch === "q")) {
      exit("SIGINT", 0);
    }

    if (ch === "\r") {
      ch = "ENTER";
    } else if (ch === "\t") {
      ch = "TAB";
    } else if (ch === "\x7f") {
      ch = "BS";
    } else if (ch === ".") {
      ch = "DOT";
    } else if (ch === "/") {
      ch = "FW";
    } else if (ch === "#") {
      ch = "HASH";
    } else if (ch === "$") {
      ch = "DOLLAR";
    } else if (ch === "[") {
      ch = "SQOPEN";
    } else if (ch === "]") {
      ch = "SQCLOSE";
    }
    //ch = ch.toString();
    var m = config.modifiers[ch];
    var k = config.keys[ch];
    if (m) {
      modifier = m;
      setTimeout(function() {
        modifier = undefined;
      }, 5000);
    } else if (k) {
      sendCommand.send(k, modifier);
      modifier = undefined;
    }

  });

  process.stdin.setRawMode(true);
  process.stdin.resume();
}



fs.readFile("keypad.json", {"encoding": "utf8"}, function(err, data) {
  if (err) {
    log.error("Unable to open config file.");
  } else {
    config = JSON.parse(data);
    fb = fbHelper.init(Keys.keys.fb, "keypad-" + config.id, exit);
    sendCommand.setConfig(config);
    log.log("Ready.");
    listen();
  }
});

function exit(sender, exitCode) {
  exitCode = exitCode || 0;
  log.log("[APP] Starting shutdown process");
  log.log("[APP] Will exit with error code: " + String(exitCode));
  setTimeout(function() {
    log.appStop(sender);
    process.exit(exitCode);
  }, 1500);
}

process.on('SIGINT', function() {
  exit("SIGINT", 0);
});