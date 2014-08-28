var fs = require("fs");
var Door = require("./Door");
var sendCommand = require("./sendCommand");
var log = require("./SystemLog");
var fbHelper = require("./fbHelper");
var Keys = require("./Keys");

var config;
var fb;

log.appStart("Door Listener");

function listen() {
  var door = new Door(config.id, config.pin);
  door.on("no-gpio", function() {
    log.error("No GPIO found.");
    //exit("NO-GPIO", 1);
  });
  door.on("changed", function(data) {
    if (data === "OPEN") {
      sendCommand.send(config.onOpen.command, config.onOpen.modifier);
    } else {
      sendCommand.send(config.onClose.command, config.onClose.modifier);
    }
  });
}

fs.readFile("config.json", {"encoding": "utf8"}, function(err, data) {
  if (err) {
    log.error("Unable to open config file.");
  } else {
    config = JSON.parse(data);
    fb = fbHelper.init(Keys.keys.fb, "door-" + config.id, exit);
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