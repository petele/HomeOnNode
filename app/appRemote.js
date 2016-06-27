'use strict';

var fs = require('fs');
var request = require('request');
var log = require('./SystemLog2');
var fbHelper = require('./FBHelper');
var Keys = require('./Keys').keys;
var Keypad = require('./Keypad');

var fb;
var config;
var cmdId = 0;
var APP_NAME = 'REMOTE';
var logOpts = {
  logFileName: './logs/system.log',
  logToFile: true
};

function sendCommand(command, path) {
  var prefix = 'sendCommand (' + cmdId++ + ')';
  var url = 'http://' + config.controller.ip + ':' + config.controller.port;
  url += path;
  var cmd = {
    uri: url,
    method: 'POST',
    json: true,
    body: command
  };
  log.log(prefix, 'Send', command);
  request(cmd, function(error, response, body) {
    if (error) {
      log.exception(prefix, 'Failed', error);
    } else {
      log.log(prefix, 'Completed', body);
    }
  });
}

fs.readFile('config.json', {'encoding': 'utf8'}, function(err, data) {
  if (err) {
    log.exception(APP_NAME, 'Unable to open config file.', err);
  } else {
    config = JSON.parse(data);
    APP_NAME = config.appName;
    log.appStart(APP_NAME, logOpts);
    fb = fbHelper.init(Keys.firebase.appId, Keys.firebase.key, APP_NAME);

    var keypadConfigPath = 'config/' + config.appName + '/keypad';
    fb.child(keypadConfigPath).on('value', function(snapshot) {
      log.log(APP_NAME, 'Keypad settings updated.');
      config.keypad = snapshot.val();
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
            log.warn(APP_NAME, 'Unknown key pressed: ' + key);
          }
        }
      });
    }
  }
});

function exit(sender, exitCode) {
  exitCode = exitCode || 0;
  log.log(APP_NAME, 'Starting shutdown process');
  log.log(APP_NAME, 'Will exit with error code: ' + String(exitCode));
  setTimeout(function() {
    log.appStop(sender);
    process.exit(exitCode);
  }, 1500);
}

process.on('SIGINT', function() {
  exit('SIGINT', 0);
});

setInterval(function() {
  log.cleanFile(logOpts.logFileName);
}, 60 * 60 * 24 * 1000);
