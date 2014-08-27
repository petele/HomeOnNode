var http = require("http");
var log = require("./SystemLog");

var config;

function setConfig(cfg) {
  config = cfg;
}

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
      log.log("Body: " + body);
      log.log("Result: " + result);
    });
  });
  request.on("error", function(error) {
    log.error(body + " " + error.code.toString());
  });
  request.setTimeout(2500, function() {
    request.abort();
  });

  request.write(body);

  request.end();

}

exports.send = sendCommand;
exports.setConfig = setConfig;