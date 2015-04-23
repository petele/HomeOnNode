'use strict';

var net = require('net');
var log = require('./SystemLog');


function AirConditioner(acID, ip, irPort, cmds) {
  var port = 4998;
  this.temperature = 0;

  function buildCommand(cmd) {
    return 'sendir,1:' + irPort + ',' + cmd;
  }

  function sendCommand(command, callback) {
    var client = new net.Socket();
    var response = '';
    client.setEncoding('ascii');
    client.setTimeout(2000);
    client.connect(port, ip, function() {
      client.write(command + '\r', 'ascii');
    });
    client.on('error', function(er) {
      log.error('[AirConditioner] Error: ' + er.toString());
      if (callback) {
        callback({'error': er});
      }
    });
    client.on('timeout', function() {
      log.warn('[AirConditioner] Timeout');
      client.destroy();
    });
    client.on('data', function(data) {
      response = data;
      client.destroy();
    });
    client.on('close', function() {
      log.debug('[AirConditioner] Response: ' + response);
      if (callback) {
        callback(response);
      }
    });
  }

  this.setTemperature = function(temperature, callback) {
    if (temperature === 0) {
      sendCommand(buildCommand(cmds.OFF), callback);
      this.temperature = 0;
    } else {
      var cmd = buildCommand(cmds[temperature.toString()]);
      if (this.temperature === 0) {
        sendCommand(buildCommand(cmds.ON), function() {
          sendCommand(cmd, callback);
        });
      } else {
        sendCommand(cmd, callback);
      }
      this.temperature = parseInt(temperature, 10);
    }
  };

  var initMsg = '[AirConditioner] ID IRCON'.replace('ID', acID);
  initMsg = initMsg.replace('IRCON', irPort);
  log.init(initMsg);
}

module.exports = AirConditioner;
