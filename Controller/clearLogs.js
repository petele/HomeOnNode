var Keys = require("./Keys");
var Firebase = require("firebase");
var fs = require("fs");

// TODO: Change this so it removes anything more than X days old;

var fb;

var fbPath = "logs";

fb = new Firebase("https://boiling-torch-4633.firebaseio.com/");
fb.auth(Keys.keys.fb, function(error) {
  if(error) {
    
  } else {
    fb.child(fbPath).remove(function() {
      console.log("Node removed.");
      process.exit();
    });
  }
});




