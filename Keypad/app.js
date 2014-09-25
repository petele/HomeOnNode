var keypress = require("keypress");
var fs = require("fs");
var log = require("../Controller/SystemLog");
var fbHelper = require("../Controller/fbHelper");
var Keys = require("../Controller/Keys");
var webRequest = require("../Controller/webRequest");

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
    log.http("KEY", ch);
    var m = config.modifiers[ch];
    var k = config.keys[ch];
    if (m) {
      modifier = m;
      setTimeout(function() {
        modifier = undefined;
      }, 5000);
    } else if (k) {
      var uri = {
        "host": config.ip,
        "port": 3000,
        "path": "/state",
        "method": "POST"
      };
      var body = {
        "command": k,
        "modifier": modifier
      };
      body = JSON.stringify(body);
      log.http("REQ", body);
      webRequest.request(uri, body, function(resp) {
        log.http("RESP", JSON.stringify(resp));
      });
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
