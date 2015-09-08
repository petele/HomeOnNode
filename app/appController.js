'use strict';

var fs = require('fs');
var log = require('./SystemLog');
var Home = require('./Home');
var Keys = require('./Keys').keys;
var HTTPServer = require('./HTTPServer');
var fbHelper = require('./FBHelper');
var Keypad = require('./Keypad');

var config;
var fb;
var home;
var httpServer;

var APP_NAME = 'HomeOnNode';

log.appStart(APP_NAME, false);

function init() {
  fb = fbHelper.init(Keys.firebase.appId, Keys.firebase.key, APP_NAME);

  log.log('[APP] Reading local config file.');

  fs.readFile('./config.json', {'encoding': 'utf8'}, function(err, data) {
    if (err) {
      log.exception('[APP] Error reading local config.json', err);
      exit('ConfigError', 1);
    } else {
      try {
        config = JSON.parse(data);
        if (config.logToFirebase === true) {
          log.setFirebase(fb);
        }
      } catch (ex) {
        log.exception('[APP] Error parsing local config.json ', ex);
        exit('ConfigError', 1);
      }
      try {
        home = new Home(config, fb);
        home.on('ready', function() {
          httpServer = new HTTPServer(config, home, fb);
          fb.child('commands').on('child_added', function(snapshot) {
            try {
              var cmd = snapshot.val();
              home.executeCommand(cmd.command, cmd.modifier, 'FB');
              snapshot.ref().remove();
            } catch (ex) {
              log.error('Unable to execute FireBase Command: ' + JSON.stringify(cmd));
            }
          });
        });
      } catch (ex) {
        log.exception('[APP] Error initializing home modules ', ex);
        exit('HomeInitError', 1);
      }
      setInterval(function() {
        loadAndRunJS('cron15.js');
      }, 15 * 60 * 1000);
      setInterval(function() {
        loadAndRunJS('cron60.js');
      }, 60 * 60 * 1000);
      setInterval(function() {
        loadAndRunJS('cronDaily.js');
      }, 24 * 60 * 60 * 1000);
    }
  });

  fs.readFile('./keypad.json', {'encoding': 'utf8'}, function(err, data) {
    var hasKeypad = true;
    if (err) {
      log.exception('[APP] Error reading local keypad.json.', err);
      hasKeypad = false;
    } else {
      try {
        var keyConfig = JSON.parse(data);
        Keypad.listen(keyConfig.keys, keyConfig.modifiers, function(cmd) {
          if (cmd.exit === true) {
            exit(cmd.reason, cmd.code);
          } else {
            home.executeCommand(cmd.command, cmd.modifier, 'KEYPAD');
          }
        });
      } catch (ex) {
        log.exception('[APP] Error starting keypad listener', ex);
        hasKeypad = false;
      }
    }
    if (hasKeypad === false) {
      log.warn('[APP] No keyboard functionality available.');
    }
  });
}

function exit(sender, exitCode) {
  if (exitCode === undefined) {
    exitCode = 0;
  }
  log.log('[APP] Starting shutdown process');
  log.log('[APP] Will exit with error code: ' + String(exitCode));
  if (home) {
    log.log('[APP] Shutting down [HOME]');
    home.shutdown();
  }
  if (httpServer) {
    log.log('[APP] Shutting down [HTTP]');
    httpServer.shutdown();
  }
  setTimeout(function() {
    log.appStop(sender);
    process.exit(exitCode);
  }, 2500);
}

process.on('SIGINT', function() {
  exit('SIGINT', 0);
});

function loadAndRunJS(file, callback) {
  log.log('[LoadAndRun] Trying to and run: ' + file);
  fs.readFile(file, function(err, data) {
    if (err) {
      log.exception('[LoadAndRun] Unable to load file.', err);
      if (callback) {
        callback(err, file);
      }
    } else {
      try {
        eval(data.toString());  // jshint ignore:line
        log.log('[LoadAndRun] Completed.');
      } catch (exception) {
        log.exception('[LoadAndRun] Exception caught on eval.', exception);
        if (callback) {
          callback(exception, file);
        }
      }
    }
    if (callback) {
      callback(null, file);
    }
  });
}

init();
