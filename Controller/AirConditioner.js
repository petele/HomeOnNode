var net = require("net");
var log = require("./SystemLog");

function AirConditioner(id, ip, port, cmds) {
  this.id = id;
  this.ip = ip;
  this.port = port;
  this.cmds = cmds;
  this.temperature = 0;
  log.init("[AirConditioner] " + id);
}

AirConditioner.prototype.setTemperature = function(temperature, callback) {
  if (temperature === 0) {
    sendCommand(this.ip, this.port, this.cmds["OFF"], callback);
    this.temperature = 0;
  } else {
    if ((this.temperature === 0) && (temperature > 0)) {
      sendCommand(this.ip, this.port, this.cmds["ON"]);
    }
    var command = this.cmds[temperature.toString()];
    if (command) {
      sendCommand(this.ip, this.port, command, callback);
      this.temperature = temperature;
    } else {
      if (callback) {
        callback({"error": "Command not found."});
      }
    }
  }
};

function sendCommand(ip, port, command, callback) {
  log.debug("[AC] sendCommand " + command);
  var client = new net.Socket();
  var response = "";
  client.setEncoding("utf8");
  client.setTimeout(750);
  client.connect(port, ip, function() {
    client.write(command + "\r");
  });
  client.on("error", function(er) {
    if (callback) {
      callback({"error": er});
    }
  });
  client.on("timeout", function() {
    client.destroy();
  });
  client.on("data", function(data) {
    response = data;
    client.destroy();
  });
  client.on("close", function() {
    if (callback) {
      callback(response);
    }
  });
}

module.exports = AirConditioner;