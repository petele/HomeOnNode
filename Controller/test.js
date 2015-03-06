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
var once = false;
fb.child("config/presence").once("value", function(snapshot) {
  var away = snapshot.val().max_away;
  presence = new Presence(away, peopleParser(snapshot.val().people));
  presence.on("change", function(data) {
    log.log("[TestHarness] " + data.present);
    if (data.present === 0) {
      send("ALERT_OFF");
    } else {
      send("ALERT_ON");
    }
  });
});
fb.child("config/presence/people").on("value", function(snapshot) {
  if (once === true) {
    if (presence) {
      var people = peopleParser(snapshot.val());
      presence.init(people);
    }
  } else {
    once = true;
  }
});


function peopleParser(people) {
  var result = [];
  var keys = Object.keys(people);
  var keyLen = keys.length;
  for (var i = 0; i < keyLen; i++) {
    var person = people[keys[i]];
    result.push(person);
  }
  return result;
}

// var people = [
//       {"name": "Pete (Mac)", "uuid": "9660b3843c5648299827400de1251b06"},
//       {"name": "Pete (Linux)", "uuid": "c05391b2f3fc"}
//     ];
// var presence = new Presence(500, people);


// presence.on("change", function(data) {
//   log.log("[TestHarness] " + data.present);
//   if (data.present === 0) {
//     send("ALERT_OFF");
//   } else {
//     send("ALERT_ON");
//   }
// });


function send(cmd, modifier) {
  var uri = {
    "host": "192.168.1.202",
    "port": 3000,
    "path": "/state",
    "method": "POST"
  };
  var body = {
    "command": cmd,
    "modifier": modifier
  };
  body = JSON.stringify(body);
  webRequest.request(uri, body, function(resp) {
  });
}


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

