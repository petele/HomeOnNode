'use strict';

var fs = require('fs');
var log = require('../Controller/SystemLog');
var fbHelper = require('../Controller/fbHelper');
var Keys = require('../Controller/Keys');
var webRequest = require('../Controller/webRequest');

var Door = require('../Controller/Door');
var Keypad = require('../Controller/Keypad');
var Dimmer = require('./Dimmer');

var fb, config, door, dimmer;

log.appStart('Remote');

function sendCommand(command) {
  var uri = {
    'host': config.ip,
    'port': config.port,
    'path': '/state',
    'method': 'POST'
  };
  if (typeof command === 'object') {
    command = JSON.stringify(command);
  }
  try {
    log.http('REQ', command);
    webRequest.request(uri, command, function(resp) {
      log.http('RESP', JSON.stringify(resp));
    });
  } catch (ex) {
    log.error('[sendCommand] ' + ex.toString());
  }
}


fs.readFile('config.json', {'encoding': 'utf8'}, function(err, data) {
  if (err) {
    log.error('Unable to open config file.');
  } else {
    config = JSON.parse(data);
    fb = fbHelper.init(Keys.keys.fb, 'remote-' + config.id, exit);

    // Check door state and start monitoring door
    if ((config.door) && (config.door.enabled === true)) {
      door = new Door(config.id, config.door.pin);
      door.on('no-gpio', function(e) {
        log.error('[DOOR] No GPIO for door ' + config.id + ' ' + e.toString());
      });
      door.on('change', function(data) {
        log.log('[DOOR] ' + config.id + ' ' + data);
        if (data === 'OPEN') {
          sendCommand(config.door.onOpen);
        } else {
          sendCommand(config.door.onClose);
        }
      });
    }

    if ((config.dimmer) && (config.dimmer.enabled === true)) {
      dimmer = new Dimmer(config.dimmer);
    }

    if ((config.keypad) && (config.keypad.enabled === true)) {
      Keypad.listen(config.keypad.keys, config.keypad.modifiers, function(data) {
        if (data.exit === true) {
          exit(data.reason, data.code);
        } else {
          sendCommand(data);
        }
      });
    }
  }
});

function exit(sender, exitCode) {
  exitCode = exitCode || 0;
  log.log('[APP] Starting shutdown process');
  log.log('[APP] Will exit with error code: ' + String(exitCode));
  setTimeout(function() {
    log.appStop(sender);
    process.exit(exitCode);
  }, 1500);
}

process.on('SIGINT', function() {
  exit('SIGINT', 0);
});
