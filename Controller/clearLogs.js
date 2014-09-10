var Keys = require("./Keys");
var Firebase = require("firebase");

var fb;
var numRunning = 0;

function init() {
  fb = new Firebase("https://boiling-torch-4633.firebaseio.com/");
  fb.auth(Keys.keys.fb, function(error) {
    if(error) {

    } else {
      cleanLogs("logs/app", 90);
      cleanLogs("logs/door", 365);
      cleanLogs("logs/system_state", 365);
    }
  });
}

function cleanLogs(path, maxAgeDays) {
  numRunning++;
  console.log("Cleaning path", path);
  fb.child(path).once("value", function(snapshot) {
    var maxAgeMilli = 60 * 60 * 24 * maxAgeDays * 1000;
    var now = Date.now();
    snapshot.forEach(function(childSnapshot) {
      var age = now - childSnapshot.val().date;
      if (age > maxAgeMilli) {
        console.log("Removed", path, childSnapshot.val());
        childSnapshot.ref().remove();
      }
    });
    numRunning--;
    exitWhenDone();
  });
}

function exitWhenDone() {
  if (numRunning === 0) {
    console.log("Done");
    process.exit(0);
  }
}

init();
