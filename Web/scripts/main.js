window.lastEvent = Date.now();

var pToast = document.querySelector("paper-toast");
var pErrorToast = document.querySelector("error-toast");
var ignoreError = true;

var fb = new Firebase("https://boiling-torch-4633.firebaseio.com/");
fb.authWithCustomToken(fbKey, function(error) {
  if(error) {
    console.error("[FIREBASE] Auth failed. " + error.toString());
    window.showErrorToast("Firebase authentication failure.");
  } else {
    console.log("[FIREBASE] Auth success.");
    fb.child(".info/connected").on("value", function(snapshot) {
      if (snapshot.val() === true) {
        window.showToast("Firebase connected.");
      } else {
        window.showErrorToast("Network disconnected.");
      }
    });
    fb.child("logs/errors").limitToLast(1).on("child_added", function(snapshot) {
      if (ignoreError === true) {
        ignoreError = false;
      } else {
        var err = snapshot.val();
        window.showErrorToast(err.message);
      }

    });
  }
});

window.showErrorToast = function(message) {
  if (pToast.opened === true) {
    pToast.dismiss();
  }
  if (message.length > 60) {
    message = message.substring(0, 59) + "...";
  }
  pErrorToast.text = message;
  pErrorToast.show();
  if (navigator.vibrate) {
    navigator.vibrate([100,30,100,30,100,200,200,30,200,30,200,200,100,30,100,30,100]);
  }
};

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
