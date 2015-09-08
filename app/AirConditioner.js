'use strict';

var net = require('net');
var log = require('./SystemLog');

function AirConditioner(acID, ip, irPort, cmds) {
  var port = 4998;
  this.temperature = 0;
  this.mode = 'off';

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
      log.error('[HVACi] Error: ' + er.toString());
      if (callback) {
        callback({'error': er});
      }
    });
    client.on('timeout', function() {
      log.warn('[HVACi] Timeout');
      client.destroy();
    });
    client.on('data', function(data) {
      response = data;
      client.destroy();
    });
    client.on('close', function() {
      log.debug('[HVACi] Response: ' + response);
      if (callback) {
        callback(response);
      }
    });
  }

  this.setTemperature = function(temperature, mode, callback) {
    var result = true;
    if (temperature === 0) {
      log.log('[HVACi] ' + acID + ' turned off.');
      sendCommand(buildCommand(cmds.OFF), callback);
      this.temperature = 0;
      this.mode = 'off';
    } else if (temperature > 75 || temperature < 60) {
      log.warn('[HVACi] Temperature out of range. ' + temperature);
      result = false;
    } else {
      var cmd = buildCommand(cmds[temperature.toString()]);
      if (this.temperature === 0) {
        log.log('[HVACi] ' + acID + ' turned on & set to ' + temperature);
        sendCommand(buildCommand(cmds.ON), function() {
          sendCommand(cmd, callback);
        });
      } else {
        log.log('[HVACi] ' + acID + ' set to ' + temperature);
        sendCommand(cmd, callback);
      }
      this.temperature = parseInt(temperature, 10);
      this.mode = mode;
    }
    return {
      temperature: this.temperature,
      mode: this.mode,
      result: result
    };
  };

  var initMsg = '[HVACi] in [ID] via [IP] on IR port: [IR]';
  initMsg = initMsg.replace('[ID]', acID);
  initMsg = initMsg.replace('[IP]', ip);
  initMsg = initMsg.replace('[IR]', irPort);
  log.init(initMsg);
}

module.exports = AirConditioner;
