'use strict';

var fs = require('fs');
var log = require('./SystemLog');
var fbHelper = require('./FBHelper');
var Keys = require('./Keys').keys;
var webRequest = require('./webRequest');

var Keypad = require('./Keypad');

var APP_NAME;
var fb;
var config;

log.appStart('Remote');

function sendCommand(command, path) {
  path = path || '/execute/name';
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

fs.readFile('config.json', {'encoding': 'utf8'}, function(err, data) {
  if (err) {
    log.exception('Unable to open config file.', err);
  } else {
    config = JSON.parse(data);
    APP_NAME = config.appName;
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
        if (logSettings.toFilename && logSettings.toFile === true) {
          log.setLogfile(logSettings.toFilename);
        } else {
          log.setLogfile(null);
        }
      }
    });

    if ((config.keypad) && (config.keypad.enabled === true)) {
      Keypad.listen(config.keypad.modifiers, function(key, modifier, exitApp) {
        if (exitApp) {
          exit('SIGINT', 0);
        } else {
          var cmdName = config.keypad.keys[key];
          if (cmdName) {
            var cmd = {
              cmdName: cmdName,
              modifier: modifier
            };
            sendCommand(cmd);
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
