var net = require("net");
var log = require("./SystemLog");


function AirConditioner(acID, ip, irConnector, cmds) {
  var port = 4998;
  this.temperature = 0;

  function buildCommand(cmd) {
    return "sendir,1:" + irConnector + "," + cmd;
  }

    function sendCommand(commands, callback) {
    var client = new net.Socket();
    var response = "";
    var responseCount = 0;
    client.setEncoding("ascii");
    client.setTimeout(1500);
    client.connect(port, ip, function() {
      for (var i = 0; i < commands.length; i++) {
        client.write(commands[i] + "\r", "ascii");
      }
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
      responseCount++;
      response += data;
      if (responseCount === commands.length) {
        client.destroy();
      }
    });
    client.on("close", function() {
      if (callback) {
        callback(response);
      }
    });
  }

  this.setTemperature = function(temperature, callback) {
    var commands = [];
    if (temperature === 0) {
      commands.push(buildCommand(cmds["OFF"]));
      this.temperature = 0;
    } else {
      if (this.temperature === 0) {
        commands.push(buildCommand(cmds["ON"]));
      }
      commands.push(buildCommand(cmds[temperature.toString()]));
      this.temperature = parseInt(temperature, 10);
    }
    if (commands.length >= 1) {
      sendCommand(commands, callback);
    }
  };

  var initMsg = "[AirConditioner] ID IRCON".replace("ID", acID);
  initMsg = initMsg.replace("IRCON", irConnector);
  log.init(initMsg);
}

module.exports = AirConditioner;