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
    send("Off");
  } else {
    send();
  }
});


function send(modifier) {
  var uri = {
    "host": "192.168.1.202",
    "port": 3000,
    "path": "/state",
    "method": "POST"
  };
  var body = {
    "command": "ALERT_TEST",
    "modifier": modifier
  };
  body = JSON.stringify(body);
  log.http("REQ", body);
  webRequest.request(uri, body, function(resp) {
    log.http("RESP", JSON.stringify(resp));
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

