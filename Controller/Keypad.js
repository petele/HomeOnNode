var log = require("./SystemLog");
var keypress = require("keypress");

function listen(keys, modifiers, callback) {
  log.init("[KeyPad]");
  var modifier;
  keypress(process.stdin);

  // listen for the "keypress" event
  process.stdin.on('keypress', function (ch, key) {
    if ((key && key.ctrl && key.name === 'c') || (ch === "q")) {
      callback({"exit": true, "reason": "SIGINT", "code": 0});
    }

    if (ch === "\r") {
      ch = "ENTER";
    } else if (ch === "\t") {
      ch = "TAB";
    } else if (ch === "\x7f") {
      ch = "BS";
    } else if (ch === ".") {
      ch = "DOT";
    } else if (ch === "/") {
      ch = "FW";
    } else if (ch === "#") {
      ch = "HASH";
    } else if (ch === "$") {
      ch = "DOLLAR";
    } else if (ch === "[") {
      ch = "SQOPEN";
    } else if (ch === "]") {
      ch = "SQCLOSE";
    }
    ch = ch.toString();
    var m = modifiers[ch];
    var k = keys[ch];
    if (m) {
      modifier = m;
      setTimeout(function() {
        modifier = undefined;
      }, 5000);
    } else if (k) {
      var body = {
        "command": k,
        "modifier": modifier
      };
      callback(body);
      modifier = undefined;
    }
  });

  process.stdin.setRawMode(true);
  process.stdin.resume();
}

exports.listen = listen;
