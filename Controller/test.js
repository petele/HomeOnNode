var Presence = require("./Presence");
var log = require("./SystemLog");
var webRequest = require("./webRequest");

var people = [
      {"name": "Pete (Mac)", "uuid": "9660b3843c5648299827400de1251b06"},
      {"name": "Pete (Linux)", "uuid": "c05391b2f3fc"}
    ];
var presence = new Presence(people);


presence.on("change", function(data) {
  log.log("[TestHarness] " + data.present);
  if (data.present === 0) {
    send("ALERT_OFF");
  } else {
    send("ALERT_ON");
  }
});


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

