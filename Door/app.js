var fs = require("fs");
var Door = require("../Controller/Door");
var log = require("../Controller/SystemLog");
var fbHelper = require("../Controller/fbHelper");
var Keys = require("../Controller/Keys");
var webRequest = require("../Controller/webRequest");

var config;
var fb;

log.appStart("Door Listener");

function listen() {
  var door = new Door(config.id, config.pin);
  door.on("no-gpio", function() {
    log.error("No GPIO found.");
    //exit("NO-GPIO", 1);
  });
  door.on("change", function(data) {
    var uri = {
      "host": config.ip,
      "port": 3000,
      "path": "/state",
      "method": "POST"
    };
    var body = {};
    if (data === "OPEN") {
      log.http("DOOR", "Opened");
      body.command = config.onOpen.command;
      body.modifier = config.onOpen.modifier;
    } else {
      log.http("DOOR", "Closed");
      body.command = config.onClose.command;
      body.modifier = config.onClose.modifier;
    }
    body = JSON.stringify(body);
    log.http("REQ", body);
    webRequest.request(uri, body, function(resp) {
      log.http("RESP", JSON.stringify(resp));
    });
  });
}

fs.readFile("config.json", {"encoding": "utf8"}, function(err, data) {
  if (err) {
    log.error("Unable to open config file.");
  } else {
    config = JSON.parse(data);
    fb = fbHelper.init(Keys.keys.fb, "door-" + config.id, exit);
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
