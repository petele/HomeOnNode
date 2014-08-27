var Keys = require("./Keys");
var Firebase = require("firebase");
var fs = require("fs");


var fb;


fb = new Firebase("https://boiling-torch-4633.firebaseio.com/");
fb.auth(Keys.keys.fb, function(error) {
  if(error) {
    
  } else {
    console.log("Reading config...");
    fs.readFile("./config.json", {"encoding": "utf8"}, function(err, data) {
      console.log("Parsing config...");
      //console.log(data, err);
      var config = JSON.parse(data);
      // console.log(config)
      console.log("Uploading config...");
      fb.child("config").set(config, function() {
        console.log("Upload completed.");
        process.exit();
      });
    });
  }
});




