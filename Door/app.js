var fs = require("fs");
var Door = require("./Door");
var sendCommand = require("./sendCommand");
var log = require("./SystemLog");

var config;
var modifier;

log.appStart("Door Listener");


function listen() {
  var door = new Door();
  door.on("no-gpio", function() {
    log.error("No GPIO found.");
  });
  door.on("changed", function(data) {
    if (data === true) {
      log.level("DOOR", "OPENED");
      sendCommand.send(config.onOpen.command, config.onOpen.modifier);
    } else {
      log.level("DOOR", "CLOSED");
      sendCommand.send(config.onClose.command, config.onClose.modifier);
    }
  });
}

function exit() {
  log.appStop("SIGINT");
  process.exit();
}

process.on('SIGINT', exit);


fs.readFile("config.json", {"encoding": "utf8"}, function(err, data) {
  if (err) {
    log.error("Unable to open config file.");
  } else {
    config = JSON.parse(data);
    sendCommand.setConfig(config);
    log.log("Ready.");
    listen();
  }
});