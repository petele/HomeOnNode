var keypress = require("keypress");
var fs = require("fs");
var http = require("http");

var config;
var modifier;

function sendCommand(command, modifier) {
  var body = JSON.stringify({
    "command": command,
    "modifier": modifier
  });
  var options = {
    hostname: config.ip,
    port: config.port,
    path: "/state",
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Content-Length": body.length
    }
  };

  var request = http.request(options, function(response) {
    var result = "";
    response.setEncoding('utf8');
    response.on('data', function (chunk) {
      result += chunk;
    });
    response.on("end", function() {
      console.log(body, result);
    });
  });
  request.on("error", function(error) {
    console.error(body, error.code);
  });
  request.setTimeout(2500, function() {
    request.abort();
  });

  request.write(body);

  request.end();

}

function listen() {
  // make `process.stdin` begin emitting "keypress" events
  keypress(process.stdin);

  // listen for the "keypress" event
  process.stdin.on('keypress', function (ch, key) {
    if (ch === "\r") {
      ch = "ENTER";
    } else if (ch === "\t") {
      ch = "TAB";
    } else if (ch === "\x7f") {
      ch = "BS";
    }
    //ch = ch.toString();
    var m = config.modifiers[ch];
    var k = config.keys[ch];
    if (m) {
      modifier = m;
      setTimeout(function() {
        modifier = undefined;
      }, 5000);
    } else if (k) {
      sendCommand(k, modifier);
      modifier = undefined;
    }
    
    if (key && key.ctrl && key.name === 'c') {
      process.stdin.pause();
    }
  });

  process.stdin.setRawMode(true);
  process.stdin.resume();
}




fs.readFile("config.json", {"encoding": "utf8"}, function(err, data) {
  if (err) {
    console.log("ERROR: Unable to open config file.")
  } else {
    config = JSON.parse(data);
    listen();
  }
});