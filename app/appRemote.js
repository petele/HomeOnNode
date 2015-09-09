'use strict';

var fs = require('fs');
var log = require('./SystemLog');
var fbHelper = require('./FBHelper');
var Keys = require('./Keys').keys;
var webRequest = require('./webRequest');

var Door = require('./Door');
var Keypad = require('./Keypad');
var Dimmer = require('./Dimmer');

var APP_NAME;
var fb;
var config;
var door;
var dimmer;

log.appStart('Remote', false);

function sendCommand(command, path) {
  path = path || '/execute';
  var uri = {
    'host': config.controller.ip,
    'port': config.controller.port,
    'path': path,
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
    log.exception('[sendCommand] Failed', ex);
  }
}

fs.readFile('remote.json', {'encoding': 'utf8'}, function(err, data) {
  if (err) {
    log.exception('Unable to open config file.', err);
  } else {
    config = JSON.parse(data);
    APP_NAME = config.appName;
    fb = fbHelper.init(Keys.firebase.appId, Keys.firebase.key, APP_NAME);

    // Check door state and start monitoring door
    if ((config.door) && (config.door.enabled === true)) {
      door = new Door(config.id, config.door.pin);
      door.on('no-gpio', function(e) {
        log.exception('[DOOR] No GPIO for door ' + config.id, e);
      });
      door.on('change', function(data) {
        log.log('[DOOR] ' + config.id + ' ' + data);
        var d;
        if (data === 'OPEN') {
          d = config.door.onOpen;
        } else {
          d = config.door.onClose;
        }
        sendCommand(d, '/door');
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
  if (dimmer) {
    dimmer.close();
  }
  setTimeout(function() {
    log.appStop(sender);
    process.exit(exitCode);
  }, 1500);
}

process.on('SIGINT', function() {
  exit('SIGINT', 0);
});
