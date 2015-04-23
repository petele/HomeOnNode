'use strict';

var fs = require('fs');
var log = require('./SystemLog');
var Home = require('./Home');
var Keys = require('./Keys');
var HTTPServer = require('./HTTPServer');
var fbHelper = require('./fbHelper');
var Keypad = require('./Keypad');

var config, fb, home, httpServer;

log.appStart('HomeOnNode');

function init() {
  fb = fbHelper.init(Keys.keys.fb, 'controller', exit);

  log.log('[APP] Reading local config file.');

  fs.readFile('./config.json', {'encoding': 'utf8'}, function(err, data) {
    if (err) {
      log.error('[APP] Error reading local config.json');
      log.debug('[APP] Error was: ' + String(err));
      exit('ConfigError', 1);
    } else {
      try {
        config = JSON.parse(data);
        home = new Home(config, fb);
        home.on('ready', function() {
          httpServer = new HTTPServer(config, home, fb);
          fb.child('commands').on('child_added', function(snapshot) {
            try {
              var cmd = snapshot.val();
              home.set(cmd.command, cmd.modifier, 'FB');
              snapshot.ref().remove();
            } catch (ex) {
              log.error('Unable to execute FireBase Command: ' + JSON.stringify(cmd));
            }
          });
          fb.child('.info/connected').on('value', function(snapshot) {
            if (snapshot.val() === true) {
              log.log('[NETWORK] Connected.');
              home.set('NETWORK_OK', undefined, 'FB-APP');
            } else {
              log.error('[NETWORK] Disconnected');
              home.set('NETWORK_ERROR', undefined, 'FB-APP');
            }
          });
        });
        setInterval(function() {
          loadAndRunJS('cron15.js');
        }, 15*60*1000);
        setInterval(function() {
          loadAndRunJS('cron60.js');
        }, 60*60*1000);
        setInterval(function() {
          loadAndRunJS('cronDaily.js');
        }, 24*60*60*1000);
      } catch (ex) {
        log.exception('[APP] Error parsing local config.json ', ex);
        exit('ConfigError', 1);
      }
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
            home.set(cmd.command, cmd.modifier);
          }
        });
      } catch (ex) {
        log.exception('[APP] Error starting keypad listener', ex);
        hasKeypad = false;
      }
    }
    if (hasKeypad === false) {
      log.warn('[APP]');
      log.warn('[APP] No keyboard functionality will be available for this session.');
      log.warn('[APP]');
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
      log.error('[LoadAndRun] Unable to load file.');
      if (callback) {
        callback(err, file);
      }
    } else {
      try {
        eval(data.toString());  // jshint ignore:line
        log.log('[LoadAndRun] Completed.');
      } catch (exception) {
        log.error('[LoadAndRun]' + JSON.stringify(exception));
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
