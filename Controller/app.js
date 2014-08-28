var log = require("./SystemLog");
var Home = require("./Home");
var Keys = require("./Keys");
var HTTPServer = require("./HTTPServer");
var Firebase = require("firebase");
var fs = require("fs");
var keypress = require("keypress");

var key_config, modifier, fb, home, httpServer;

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
  log.appStart("HomeOnNode");
  fb = new Firebase("https://boiling-torch-4633.firebaseio.com/");

  fb.auth(Keys.keys.fb, function(error) {
    if(error) {
      log.error("[FIREBASE] Auth failed. " + error.toString());
    } else {
      log.log("[FIREBASE] Auth success.");
    }
  });

  log.log("[APP] Reading local config file.");

  fs.readFile("./config.json", {"encoding": "utf8"}, function(data) {
    home = new Home(data, fb);
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
  });

  fs.readFile("./main_keypad.json", {"encoding": "utf8"}, function(err, data) {
    if (err) {
      console.log(err);
      log.error("Unable to open keypad config file.");
    } else {
      key_config = JSON.parse(data);
      listen();
    }
  });
}

function exit() {
  log.appStop("SIGINT");
  home.shutdown();
  httpServer.shutdown();
  setTimeout(function() {
    process.exit();
  }, 5000);
}

process.on('SIGINT', exit);

init();
