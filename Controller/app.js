var log = require("./SystemLog");
var Home = require("./Home");
var Keys = require("./Keys");
var HTTPServer = require("./HTTPServer");
var Firebase = require("firebase");


var fb, home, httpServer;

function init() {
  log.appStart();
  fb = new Firebase("https://boiling-torch-4633.firebaseio.com/");
  fb.auth(Keys.keys.fb, function(error) {
    if(error) {
      
    } else {
      home = new Home(fb);
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
    }
  });
}

init();
