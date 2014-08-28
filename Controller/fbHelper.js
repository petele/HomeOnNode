var Firebase = require("firebase");
var log = require("./SystemLog");

function init(key, appName, exit) {
  var fb = new Firebase("https://boiling-torch-4633.firebaseio.com/");

  fb.auth(key, function(error) {
    if(error) {
      log.error("[FIREBASE] Auth failed. " + error.toString());
    } else {
      log.log("[FIREBASE] Auth success.");
    }
  });

  log.initFirebase(fb, appName);

  fb.child(appName + "/restart").on("value", function(snapshot) {
    if (snapshot.val() === "restart") {
      snapshot.ref().remove();
      exit("fbRestart", 10);
    }
  });

  fb.child(appName + "/shutdown").on("value", function(snapshot) {
    if (snapshot.val() === "shutdown") {
      snapshot.ref().remove();
      exit("fbShutdown", 0);
    }
  });

  fb.child("config/logToFirebase").on("value", function(snapshot) {
    log.enableFirebase(snapshot.val());
    log.log("[APP] Firebase logging enabled: " + snapshot.val());
  });

  return fb;
}

exports.init = init;
