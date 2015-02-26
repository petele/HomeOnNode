var Presence = require("./Presence");


var people = [
      {"name": "Phone", "mac": "4480eb4d4120"},
      {"name": "FitBit", "mac": "xyz789"}
    ];
var presence = new Presence(people);

presence.on("change", function(data) {
  console.log("change", JSON.stringify(data));
});

presence.on("none", function(data) {
  console.log("none", JSON.stringify(data));
});