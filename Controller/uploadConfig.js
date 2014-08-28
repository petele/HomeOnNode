var Keys = require("./Keys");
var Firebase = require("firebase");
var fs = require("fs");


var fb;

var file = "./config.json";
var fbPath = "config";

fb = new Firebase("https://boiling-torch-4633.firebaseio.com/");
fb.auth(Keys.keys.fb, function(error) {
  if(error) {
    
  } else {
    console.log("Reading config...");
    fs.readFile(file, {"encoding": "utf8"}, function(err, data) {
      console.log("Parsing config...");
      //console.log(data, err);
      var config = JSON.parse(data);
      console.log("Uploading config...");
      fb.child(fbPath).set(config, function() {
        console.log("Upload completed.");
        process.exit();
      });
    });
  }
});




