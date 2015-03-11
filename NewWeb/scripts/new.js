
window.lastEvent = Date.now();

var pToast = document.querySelector("paper-toast");

var fb = new Firebase("https://boiling-torch-4633.firebaseio.com/");
fb.auth(fbKey, function(error) {
  if(error) {
    console.error("[FIREBASE] Auth failed. " + error.toString());
    showToast("Firebase authentication failure.");
  } else {
    console.log("[FIREBASE] Auth success.");
    fb.child(".info/connected").on("value", function(snapshot) {
      if (snapshot.val() === true) {
        window.showToast("Firebase connected.");
      } else {
        window.showToast("Network disconnected.");
      }
    });
  }
});



window.showToast = function(message) {
  pToast.text = message;
  pToast.show();
};

window.getCommands = function(commands, filter) {
  var result = [];
  var keys = Object.keys(commands);
  for (var i = 0; i < keys.length; i++) {
    var key = keys[i];
    var command = commands[key];
    if (command.label) {
      command.command = key;
      if (filter) {
        if (command.kind === filter) {
          result.push(command);
        }
      } else {
        result.push(command);
      }
    }
  }
  return result;
};
