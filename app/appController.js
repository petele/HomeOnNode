'use strict';

const fs = require('fs');
const log = require('./SystemLog2');
const Home = require('./Home');
const Keys = require('./Keys').keys;
const HTTPServer = require('./HTTPServer');
const fbHelper = require('./FBHelper');
const Keypad = require('./Keypad');
const WSServer = require('./WSServer');

const LOG_PREFIX = 'APP';
const APP_NAME = 'HomeOnNode';

let fb;
let wss;
let home;
let config;
let httpServer;

log.setAppName(APP_NAME);
log.setOptions({firebaseLogLevel: 50, firebasePath: 'logs/server'});
log.startWSS();
log.appStart();

/**
 * Init
*/
function init() {
  fb = fbHelper.init(Keys.firebase.appId, Keys.firebase.key, APP_NAME);
  log.setFirebaseRef(fb);

  fb.child(`config/HomeOnNode/logs`).on('value', (snapshot) => {
    const logOpts = snapshot.val();
    log.setOptions(logOpts);
    log.debug(LOG_PREFIX, 'Log config updated', logOpts);
  });

  log.log(LOG_PREFIX, `Reading local config.`);
  fs.readFile('./config.json', {'encoding': 'utf8'}, function(err, data) {
    if (err) {
      log.exception(LOG_PREFIX, `Error reading 'config.json' file.`, err);
      exit('ConfigError', 1);
      return;
    }

    try {
      log.verbose(LOG_PREFIX, `Parsing 'config.json'.`);
      config = JSON.parse(data);
    } catch (ex) {
      log.exception(LOG_PREFIX, `Error parsing 'config.json' file.`, ex);
      exit('ConfigError', 1);
      return;
    }

    try {
      home = new Home(config, fb);
    } catch (ex) {
      log.exception(LOG_PREFIX, `Error initializing 'home' module.`, ex);
      exit('HomeInitError', 1);
      return;
    }

    httpServer = new HTTPServer();
    httpServer.on('executeCommandByName', (name, modifier, sender) => {
      home.executeCommandByName(name, modifier, sender);
    });
    httpServer.on('executeCommand', (cmd, sender) => {
      home.executeCommand(cmd, sender);
    });
    httpServer.on('doorbell', (sender) => {
      home.ringDoorbell(sender);
    });

    wss = new WSServer('CMD', 3003);
    wss.on('message', (cmd, source) => {
      if (cmd.hasOwnProperty('doorbell')) {
        home.ringDoorbell(source);
      } else if (cmd.hasOwnProperty('cmdName')) {
        home.executeCommandByName(cmd.cmdName, cmd.modifier, source);
      } else {
        home.executeCommand(cmd, source);
      }
    });

    fb.child('config/HomeOnNode').on('value', function(snapshot) {
      config = snapshot.val();
      home.updateConfig(config);
      fs.writeFile('config.json', JSON.stringify(config, null, 2), (err) => {
        if (err) {
          log.exception(LOG_PREFIX, `Unable to save 'config.json'`, err);
          return;
        }
        log.debug(LOG_PREFIX, `Updated config saved to 'config.json'`);
      });
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
            return;
          }
          const cmdName = config.keypad.keys[key];
          if (cmdName) {
            home.executeCommandByName(cmdName, modifier, 'KEYPAD');
            return;
          }
          const details = {
            key: key,
            modifier: modifier,
            exitApp: exitApp,
          };
          log.warn(LOG_PREFIX, `Unknown key pressed.`, details);
        }
      );
    } catch (ex) {
      log.exception(LOG_PREFIX, 'Error initializing keyboard', ex);
    }

    const cron15m = getCronIntervalValue(15, 30);
    log.log(LOG_PREFIX, `CRON_15 - ${Math.floor(cron15m / 1000)} seconds`);
    setInterval(function() {
      loadAndRunJS('cron15.js');
    }, cron15m);

    const cron60m = getCronIntervalValue(60, 2 * 60);
    log.log(LOG_PREFIX, `CRON_60 - ${Math.floor(cron60m / 1000)} seconds`);
    setInterval(function() {
      loadAndRunJS('cron60.js');
    }, cron60m);

    const cron24h = getCronIntervalValue(24 * 60, 5 * 60);
    log.log(LOG_PREFIX, `CRON_24 - ${Math.floor(cron24h / 1000)} seconds`);
    setInterval(function() {
      loadAndRunJS('cronDaily.js');
    }, cron24h);
  });
}

/**
 * Generate the interval delay for the daily cron jobs.
 *
 * @param {Number} minutes How often the cron job should run, in minutes.
 * @param {Number} delaySeconds Add/subtract up to X number of delay seconds.
 * @return {Number} The number of milliseconds to wait between calls.
 */
function getCronIntervalValue(minutes, delaySeconds) {
  const baseDelay = minutes * 60 * 1000;
  const delayMS = delaySeconds * 1000;
  const minimumDelay = delayMS / 2;
  const randomDelay = Math.random() * minimumDelay;
  const totalDelay = Math.round(minimumDelay + randomDelay);
  if (Math.random() > 0.5) {
    return baseDelay + totalDelay;
  }
  return baseDelay - totalDelay;
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
