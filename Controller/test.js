var Presence = require("./Presence");
var log = require("./SystemLog");
var webRequest = require("./webRequest");
var Firebase = require("firebase");
var Keys = require("./Keys");

var presence;
var fb = new Firebase("https://boiling-torch-4633.firebaseio.com/");
fb.auth(Keys.keys.fb, function(error) {
  if(error) {

  } else {

  }
});
fb.child("config/presence").once("value", function(snapshot) {
  var away = snapshot.val().max_away;
  presence = new Presence(away);
  presence.on("change", function(data) {
    fb.child("logs/presence").push(data.person);
  });
  fb.child("config/presence/people").on("value", function(snapshot) {
    presence.addPeople(snapshot.val());
  });
});



// ----


// ----

// var keys = Keys.keys;
// var Dropcam = require("./Dropcam");


// var dropcam = new Dropcam(keys.dropcam.user, keys.dropcam.password, keys.dropcam.uuid);
// dropcam.on("ready", function() {
//   dropcam.enableCamera(true, function(a, b) {
//     console.log("inside",a,b);
//   });
// });
// dropcam.on("error", function(err) {
//   console.log("DropCam Error", err);
// });
