var Presence = require("./Presence");
var log = require("./SystemLog");

var people = [
      {"name": "Pete", "uuid": "88d89697672b4a429060e8a1d75236c4"},
      {"name": "FitBit", "uuid": "xyz789"}
    ];
var presence = new Presence(people);


presence.on("change", function(data) {
  log.log("[TestHarness] " + data.present);
  //console.log("change", data);
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

