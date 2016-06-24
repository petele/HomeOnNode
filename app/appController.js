'use strict';

var fs = require('fs');
var log = require('./SystemLog2');
var Home = require('./Home');
var Keys = require('./Keys').keys;
var HTTPServer = require('./HTTPServer');
var fbHelper = require('./FBHelper');
var Keypad = require('./Keypad');

var config;
var fb;
var home;
var httpServer;
var LOG_PREFIX = 'APP';
var APP_NAME = 'HomeOnNode';
var logOpts = {
  logFileName: './start.log',
  logToFile: true,
  logToFirebase: true
};
log.appStart(APP_NAME, logOpts);

function init() {
  fb = fbHelper.init(Keys.firebase.appId, Keys.firebase.key, APP_NAME);
  log.setFirebaseRef(fb);
  log.setOptions({logToFile: false});

  log.log(LOG_PREFIX, 'Reading local config file.');
  fs.readFile('./config.json', {'encoding': 'utf8'}, function(err, data) {
    if (err) {
      log.exception(LOG_PREFIX, 'Error reading local config.json', err);
      exit('ConfigError', 1);
    } else {
      try {
        config = JSON.parse(data);
      } catch (ex) {
        log.exception(LOG_PREFIX, 'Error parsing local config.json ', ex);
        exit('ConfigError', 1);
      }

      try {
        home = new Home(config, fb);
      } catch (ex) {
        log.exception(LOG_PREFIX, 'Error initializing home modules ', ex);
        exit('HomeInitError', 1);
      }

      home.on('ready', function() {
        httpServer = new HTTPServer(config, home, fb);
      });

      fb.child('commands').on('child_added', function(snapshot) {
        var cmd = null;
        try {
          cmd = snapshot.val();
          if (cmd.hasOwnProperty('cmdName')) {
            home.executeCommandByName(cmd.cmdName, cmd.modifier, 'FB');
          } else {
            home.executeCommand(cmd, 'FB');
          }
        } catch (ex) {
          var msg = 'Unable to execute Firebase Command: ';
          msg += JSON.stringify(cmd);
          log.exception(LOG_PREFIX, msg, ex);
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
        log.exception(LOG_PREFIX, 'Error initializing keyboard', ex);
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
  log.log(LOG_PREFIX, 'Starting shutdown process');
  log.log(LOG_PREFIX, 'Will exit with error code: ' + String(exitCode));
  if (home) {
    log.log(LOG_PREFIX, 'Shutting down [HOME]');
    home.shutdown();
  }
  if (httpServer) {
    log.log(LOG_PREFIX, 'Shutting down [HTTP]');
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
  log.debug(LOG_PREFIX, 'loadAndRunJS (' + file + ')');
  fs.readFile(file, function(err, data) {
    if (err) {
      log.exception(LOG_PREFIX, 'loadAndRunJS: Unable to load file.', err);
      if (callback) {
        callback(err, file);
      }
    } else {
      try {
        eval(data.toString());  // jshint ignore:line
      } catch (ex) {
        log.exception(LOG_PREFIX, 'loadAndRunJS: Exception caught on eval.', ex);
        if (callback) {
          callback(ex, file);
        }
      }
    }
    if (callback) {
      callback(null, file);
    }
  });
}

init();
