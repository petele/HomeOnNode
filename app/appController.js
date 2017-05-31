'use strict';

const fs = require('fs');
const log = require('./SystemLog2');
const Home = require('./Home');
const Keys = require('./Keys').keys;
const HTTPServer = require('./HTTPServer');
const fbHelper = require('./FBHelper');
const Keypad = require('./Keypad');

const LOG_PREFIX = 'APP';
const APP_NAME = 'HomeOnNode';

let config;
let fb;
let home;
let httpServer;

log.setAppName(APP_NAME);
log.setOptions({firebaseLogLevel: 50, firebasePath: 'logs/server'});
log.appStart();

/**
 * Init
*/
function init() {
  fb = fbHelper.init(Keys.firebase.appId, Keys.firebase.key, APP_NAME);
  log.setFirebaseRef(fb);

  fb.child(`config/HomeOnNode/logs`).on('value', (snapshot) => {
    log.setOptions(snapshot.val());
    log.debug(LOG_PREFIX, 'Log config updated');
  });

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
        httpServer = new HTTPServer(config, home);
      });

      fb.child('commands').on('child_added', function(snapshot) {
        let cmd;
        try {
          cmd = snapshot.val();
          if (cmd.hasOwnProperty('cmdName')) {
            home.executeCommandByName(cmd.cmdName, cmd.modifier, 'FB');
          } else {
            home.executeCommand(cmd, 'FB');
          }
        } catch (ex) {
          let msg = 'Unable to execute Firebase Command: ';
          msg += JSON.stringify(cmd);
          log.exception(LOG_PREFIX, msg, ex);
        }
        snapshot.ref().remove();
      });

      try {
        Keypad.listen(config.keypad.modifiers,
          function(key, modifier, exitApp) {
            if (exitApp) {
              exit('SIGINT', 0);
            } else {
              home.handleKeyEntry(key, modifier, 'KEYPAD');
            }
          }
        );
      } catch (ex) {
        log.exception(LOG_PREFIX, 'Error initializing keyboard', ex);
      }

      const cron15m = getCronIntervalValue(15, 5);
      log.log(LOG_PREFIX, `CRON_15 - ${Math.floor(cron15m / 1000)} seconds`);
      setInterval(function() {
        loadAndRunJS('cron15.js');
      }, cron15m);

      const cron60m = getCronIntervalValue(60, 30);
      log.log(LOG_PREFIX, `CRON_60 - ${Math.floor(cron60m / 1000)} seconds`);
      setInterval(function() {
        loadAndRunJS('cron60.js');
      }, cron60m);

      const cron24h = getCronIntervalValue(24 * 60, 90);
      log.log(LOG_PREFIX, `CRON_24 - ${Math.floor(cron24h / 1000)} seconds`);
      setInterval(function() {
        loadAndRunJS('cronDaily.js');
      }, cron24h);
    }
  });
}

/**
 * Generate the interval delay for the daily cron jobs.
 *
 * @param {Number} minutes How often the cron job should run, in minutes.
 * @param {Number} delaySeconds Add up to X number of delay seconds.
 * @return {Number} The number of milliseconds to wait between calls.
 */
function getCronIntervalValue(minutes, delaySeconds) {
  const delayMS = delaySeconds * 1000;
  return (minutes * 60 * 1000) + Math.floor(Math.random() * delayMS);
}


/**
 * Exit the app.
 *
 * @param {String} sender Who is requesting the app to exit.
 * @param {Number} [exitCode] The exit code to use.
*/
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

/**
 * Load and run a JavaScript file.
 *   Used for the cron job system.
 *
 * @param {String} file The file to load and run.
 * @param {Function} [callback] Callback to run once completed.
*/
function loadAndRunJS(file, callback) {
  let msg = `loadAndRunJS('${file}')`;
  log.debug(LOG_PREFIX, msg);
  fs.readFile(file, function(err, data) {
    if (err) {
      log.exception(LOG_PREFIX, msg + ' Unable to load file.', err);
      if (callback) {
        callback(err, file);
      }
    } else {
      try {
        eval(data.toString());
      } catch (ex) {
        log.exception(LOG_PREFIX, msg + ' Exception on eval.', ex);
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
