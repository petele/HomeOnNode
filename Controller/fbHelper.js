var Firebase = require("firebase");
var log = require("./SystemLog");

function init(key, appName, exit) {
  var fb = new Firebase("https://boiling-torch-4633.firebaseio.com/");
  appName = appName.toLowerCase();

  fb.auth(key, function(error) {
    if(error) {
      log.error("[FIREBASE] Auth failed. " + error.toString());
    } else {
      log.log("[FIREBASE] Auth success.");
    }
  });

  var def = {
    "started_at": Date.now(),
    "heartbeat": Date.now(),
    "restart": false,
    "shutdown": false
  };
  fb.child("devices/" + appName).update(def);

  setInterval(function() {
    fb.child("devices/" + appName + "/heartbeat").set(Date.now());
  }, 60000);

  log.initFirebase(fb, appName);

  fb.child("devices/" + appName + "/restart").on("value", function(snapshot) {
    if (snapshot.val() === true) {
      snapshot.ref().remove();
      exit("fbRestart", 10);
    }
  });

  fb.child("devices/" + appName + "/shutdown").on("value", function(snapshot) {
    if (snapshot.val() === true) {
      snapshot.ref().remove();
      exit("fbShutdown", 0);
    }
  });

  fb.child("devices/" + appName + "/logToFirebase").on("value", function(snapshot) {
    var result = false;
    if (snapshot.val() === true) {
      result = true;
    }
    log.enableFirebase(result);
    log.log("[APP] Firebase logging enabled: " + result);
  });

  fb.child("devices/" + appName + "/debugLog").on("value", function(snapshot) {
    var result = false;
    if (snapshot.val() === true) {
      result = true;
    }
    log.enableDebug(result);
    log.log("[APP] Debug level logging enabled: " + result);
  });

  return fb;
}

exports.init = init;
