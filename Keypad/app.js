var keypress = require("keypress");
var fs = require("fs");
var sendCommand = require("./sendCommand");
var log = require("./SystemLog");


var config;
var modifier;

log.appStart("KeyPad");

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
    
    if (key && key.ctrl && key.name === 'c') {
      log.appStop("SIGINT");
      process.stdin.pause();
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
    sendCommand.setConfig(config);
    log.log("Ready.");
    listen();
  }
});