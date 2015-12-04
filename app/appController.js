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
log.appStart(APP_NAME);

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
      } catch (ex) {
        log.exception('[APP] Error parsing local config.json ', ex);
        exit('ConfigError', 1);
      }

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

      try {
        home = new Home(config, fb);
      } catch (ex) {
        log.exception('[APP] Error initializing home modules ', ex);
        exit('HomeInitError', 1);
      }

      home.on('ready', function() {
        httpServer = new HTTPServer(config, home, fb);
      });

      fb.child('commands').on('child_added', function(snapshot) {
        var cmd = null;
        try {
          cmd = snapshot.val();
          if (cmd.cmdName) {
            home.executeCommandByName(cmd.cmdName, cmd.modifier, 'FB');
          } else if (cmd.huePath) {
            home.executeHueCommand(cmd.huePath, cmd.method, cmd.body, 'FB');
          } else {
            var msg = '[APP] Unknown command recieved from Firebase';
            msg += JSON.stringify(cmd);
            log.error(msg);
          }
        } catch (ex) {
          var msg = '[APP] Unable to execute Firebase Command: ';
          msg += JSON.stringify(cmd);
          log.exception(msg, ex);
        }
        snapshot.ref().remove();
      });

      try {
        Keypad.listen(config.keypad.modifiers, function(key, modifier, exitApp) {
          if (exitApp) {
            exit('SIGINT', 0);
          } else {
            home.handleKeyEntry(key, modifier, 'KEYPAD');
          }
        });
      } catch (ex) {
        log.exception('[APP] Error initializing keyboard', ex);
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
  log.debug('[LoadAndRun] Trying to and run: ' + file);
  fs.readFile(file, function(err, data) {
    if (err) {
      log.exception('[LoadAndRun] Unable to load file.', err);
      if (callback) {
        callback(err, file);
      }
    } else {
      try {
        eval(data.toString());  // jshint ignore:line
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
