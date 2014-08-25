var fs = require("fs");
var http = require("http");
var Door = require("./Door");

var config;

function sendCommand(body) {
  var options = {
    hostname: config.ip,
    port: config.port,
    path: "/state",
    method: "POST"
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

  request.write(JSON.stringify(body));

  request.end();

}

function listen() {
  var door = new Door();
  door.on("no-gpio", function() {
    console.log("ERROR: No GPIO found.");
  });
  door.on("changed", function(data) {
    if (data === true) {
      sendCommand(config.onOpen);
    } else {
      sendCommand(config.onClose);
    }
  });
}


fs.readFile("config.json", {"encoding": "utf8"}, function(err, data) {
  if (err) {
    console.log("ERROR: Unable to open config file.");
  } else {
    config = JSON.parse(data);
    listen();
  }
});