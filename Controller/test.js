// var Presence = require("./Presence");
var Keys = require("./Keys");

// var people = [
//       {"name": "Phone", "mac": "4480eb4d4120"},
//       {"name": "FitBit", "mac": "xyz789"}
//     ];
// var presence = new Presence(people);

// presence.on("change", function(data) {
//   console.log("change", JSON.stringify(data));
// });

// presence.on("none", function(data) {
//   console.log("none", JSON.stringify(data));
// });

var keys = Keys.keys;
var Dropcam = require("./Dropcam");

var dropcam = new Dropcam(keys.dropcam.user, keys.dropcam.password, keys.dropcam.uuid);
dropcam.on("ready", function() {
  dropcam.enableCamera(true, function(a, b) {
    console.log("inside",a,b);
  });
});

