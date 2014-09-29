var fs = require("fs");
var log = require("../Controller/SystemLog");
var fbHelper = require("../Controller/fbHelper");
var Keys = require("../Controller/Keys");
var Dimmer = require("./Dimmer");


var fb, config, dimmer;

log.appStart("Dimmer");

fs.readFile("dimmer.json", {"encoding": "utf8"}, function(err, data) {
  if (err) {
    log.error("Unable to open config file.");
  } else {
    config = JSON.parse(data);
    fb = fbHelper.init(Keys.keys.fb, "dimmer-" + config.id, exit);
    dimmer = new Dimmer(config);
    log.log("Ready.");
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
