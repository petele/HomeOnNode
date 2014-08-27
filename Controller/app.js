var log = require("./SystemLog");
var Home = require("./Home");
var Keys = require("./Keys");
var HTTPServer = require("./HTTPServer");
var Firebase = require("firebase");
var fs = require("fs");


var fb, home, httpServer;

function init() {
  log.appStart("HomeOnNode");
  fb = new Firebase("https://boiling-torch-4633.firebaseio.com/");
  fb.auth(Keys.keys.fb, function(error) {
    if(error) {
      
    } else {
      fs.readFile("./config.json", {"encoding": "utf8"}, function(data) {
        home = new Home(data, fb);
        home.on("ready", function() {
          httpServer = new HTTPServer(home);
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