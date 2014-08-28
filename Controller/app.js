var log = require("./SystemLog");
var Home = require("./Home");
var Keys = require("./Keys");
var HTTPServer = require("./HTTPServer");
var Firebase = require("firebase");
var fs = require("fs");
var keypress = require("keypress");

var key_config, config, modifier, fb, home, httpServer;

log.appStart("HomeOnNode");

function listen() {
  // make `process.stdin` begin emitting "keypress" events
  keypress(process.stdin);

  // listen for the "keypress" event
  process.stdin.on('keypress', function (ch, key) {
    if (ch === "\r") {
      ch = "ENTER";
    } else if (ch === "\t") {
      ch = "TAB";
    } else if (ch === "\x7f") {
      ch = "BS";
    }
    var m = key_config.modifiers[ch];
    var k = key_config.keys[ch];
    if (m) {
      modifier = m;
      setTimeout(function() {
        modifier = undefined;
      }, 5000);
    } else if (k) {
      home.set(k, modifier, "local");
      modifier = undefined;
    }

    if (key && key.ctrl && key.name === 'c') {
      exit();
    }
  });

  process.stdin.setRawMode(true);
  process.stdin.resume();
}

function init() {
  
  fb = new Firebase("https://boiling-torch-4633.firebaseio.com/");

  fb.auth(Keys.keys.fb, function(error) {
    if(error) {
      log.error("[FIREBASE] Auth failed. " + error.toString());
      exit("fbAuthFailure", 1);
    } else {
      log.log("[FIREBASE] Auth success.");
    }
  });

  fb.child("restart").on("child_added", function(snapshot) {
    snapshot.ref().remove();
    exit("fbRestart", 10);
  });

  fb.child("shutdown").on("child_added", function(snapshot) {
    snapshot.ref().remove();
    exit("fbShutdown", 0);
  });

  log.log("[APP] Reading local config file.");

  fs.readFile("./config.json", {"encoding": "utf8"}, function(err, data) {
    if (err) {
      log.error("[APP] Error reading local config.json");
      log.debug("[APP] Error was: " + String(err));
      exit("ConfigError", 1);
    } else {
      try {
        config = JSON.parse(data);
        home = new Home(config, fb);
        home.on("ready", function() {
          httpServer = new HTTPServer(home, fb);
          fb.child("commands").on("child_added", function(snapshot) {
            try {
              var cmd = snapshot.val();
              home.set(cmd.command, cmd.modifier, "FB");
              snapshot.ref().remove();
            } catch (ex) {
              log.error("Unable to execute FireBase Command: " + JSON.stringify(cmd));
            }
          });
        });
      } catch (ex) {
        log.error("[APP] Error parsing local config.json " + ex.toString());
        exit("ConfigError", 1);
      }
    }
  });

  fs.readFile("./keypad.json", {"encoding": "utf8"}, function(err, data) {
    if (err) {
      log.error("[APP] Error reading local keypad.json.");
      log.debug("[APP] Error was: " + String(err));
      log.warn("[APP]");
      log.warn("[APP] No keyboard functionality will be available for this session.");
      log.warn("[APP]");
    } else {
      key_config = JSON.parse(data);
      listen();
    }
  });
}

function exit(sender, exitCode) {
  exitCode = exitCode || 0;
  log.appStop(sender);
  home.shutdown();
  httpServer.shutdown();
  setTimeout(function() {
    process.exit(exitCode);
  }, 5000);
}

process.on('SIGINT', function() {
  exit("SIGINT", 0);
});

init();
