'use strict';

var fs = require('fs');
var request = require('request');
var log = require('./SystemLog');
var fbHelper = require('./FBHelper');
var Keys = require('./Keys').keys;

var Keypad = require('./Keypad');

var APP_NAME = 'REMOTE';
var fb;
var config;

log.setLogFileName('./start.log');
log.setFileLogging(true);

function sendCommand(command, path) {
  var url = 'http://' + config.controller.ip + ':' + config.controller.port;
  url += path;
  var cmd = {
    uri: url,
    method: 'POST',
    json: true,
    body: command
  };
  log.http('REQ', JSON.stringify(command));
  request(cmd, function(error, response, body) {
    if (error) {
      log.exception('[sendCommand] Failed', error);
    } else {
      log.log('[sendCommand] ' + JSON.stringify(body));
    }
  });
}

fs.readFile('config.json', {'encoding': 'utf8'}, function(err, data) {
  if (err) {
    log.exception('Unable to open config file.', err);
  } else {
    config = JSON.parse(data);
    APP_NAME = config.appName;
    log.appStart(APP_NAME);
    fb = fbHelper.init(Keys.firebase.appId, Keys.firebase.key, APP_NAME);

    var keypadConfigPath = 'config/' + config.appName + '/keypad';
    fb.child(keypadConfigPath).on('value', function(snapshot) {
      log.log('[REMOTE] Keypad settings updated.');
      config.keypad = snapshot.val();
    });

    fb.child('config/' + APP_NAME + '/logs').on('value', function(snapshot) {
      var logSettings = snapshot.val();
      if (logSettings) {
        if (logSettings.logLevel === 'DEBUG') {
          log.setDebug(true);
        } else {
          log.setDebug(false);
        }
        if (logSettings.toFirebase === true) {
          log.setFirebase(fb);
        } else {
          log.setFirebase(null);
        }
        if (logSettings.toFilename) {
          log.setLogFileName(logSettings.toFilename);
        }
        if (logSettings.toFile === true) {
          log.setFileLogging(true);
        } else {
          log.setFileLogging(false);
        }
      }
    });

    if ((config.keypad) && (config.keypad.enabled === true)) {
      Keypad.listen(config.keypad.modifiers, function(key, modifier, exitApp) {
        if (exitApp) {
          exit('SIGINT', 0);
        } else {
          var cmd = config.keypad.keys[key];
          if (cmd) {
            cmd.modifier = modifier;
            var path = '/execute';
            if (cmd.hasOwnProperty('cmdName')) {
              path = '/execute/name';
            }
            sendCommand(cmd, path);
          } else {
            log.warn('[HOME] Unknown key pressed: ' + key);
          }
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
