'use strict';

const fs = require('fs');
const Home = require('./Home');
const Keypad = require('./Keypad');
const log = require('./SystemLog2');
const Keys = require('./Keys').keys;
const Firebase = require('firebase');
const WSServer = require('./WSServer');
const HTTPServer = require('./HTTPServer');
const DeviceMonitor = require('./DeviceMonitor');

const APP_NAME = 'HomeOnNode';

let _fb;
let _wss;
let _home;
let _config;
let _httpServer;
let _deviceMonitor;

log.setAppName(APP_NAME);
log.setOptions({firebaseLogLevel: 50, firebasePath: 'logs/server'});
log.startWSS();
log.appStart();

/**
 * Init
*/
function init() {
  _fb = new Firebase(`https://${Keys.firebase.appId}.firebaseio.com/`);
  _fb.authWithCustomToken(Keys.firebase.key, function(error, authToken) {
    if (error) {
      log.exception(APP_NAME, 'Firebase auth failed.', error);
    } else {
      log.log(APP_NAME, 'Firebase auth success.');
    }
  });
  log.setFirebaseRef(_fb);
  _deviceMonitor = new DeviceMonitor(_fb.child('devices'), APP_NAME);
  _deviceMonitor.on('restart_request', () => {
    _close();
    _deviceMonitor.restart('FB', 'restart_request', false);
  });
  _deviceMonitor.on('shutdown_request', () => {
    _close();
    _deviceMonitor.shutdown('FB', 'shutdown_request', 0);
  });

  _fb.child(`config/HomeOnNode/logs`).on('value', (snapshot) => {
    const logOpts = snapshot.val();
    log.setOptions(logOpts);
    log.debug(APP_NAME, 'Log config updated', logOpts);
  });

  let data;
  try {
    log.debug(APP_NAME, `Reading 'config.json'.`);
    data = fs.readFileSync('config.json', {encoding: 'utf8'});
  } catch (ex) {
    const msg = `Error reading 'config.json' file.`;
    log.exception(APP_NAME, msg, ex);
    _close();
    _deviceMonitor.shutdown('read_config', msg, 1);
    return;
  }

  try {
    log.debug(APP_NAME, `Parsing 'config.json'.`);
    _config = JSON.parse(data);
  } catch (ex) {
    const msg = `Error parsing 'config.json' file.`;
    log.exception(APP_NAME, msg, ex);
    _close();
    _deviceMonitor.shutdown('parse_config', msg, 1);
    return;
  }

  try {
    _home = new Home(_config, _fb);
  } catch (ex) {
    const msg = `Error initializing 'home' module.`;
    log.exception(APP_NAME, msg, ex);
    _close();
    _deviceMonitor.shutdown('init_home_fail', msg, 1);
    return;
  }

  if (_config.cmdPorts.http) {
    _httpServer = new HTTPServer(_config.cmdPorts.http);
    _httpServer.on('executeCommandByName', (name, modifier, sender) => {
      _home.executeCommandByName(name, modifier, sender);
    });
    _httpServer.on('executeCommand', (cmd, sender) => {
      _home.executeCommand(cmd, sender);
    });
  }

  if (_config.cmdPorts.wss) {
    _wss = new WSServer('CMD', _config.cmdPorts.wss);
    _wss.on('message', (cmd, source) => {
      if (cmd.hasOwnProperty('cmdName')) {
        _home.executeCommandByName(cmd.cmdName, cmd.modifier, source);
      } else {
        _home.executeCommand(cmd, source);
      }
    });
  }

  _fb.child('config/HomeOnNode').on('value', function(snapshot) {
    _config = snapshot.val();
    _home.updateConfig(_config);
    fs.writeFile('config.json', JSON.stringify(_config, null, 2), (err) => {
      if (err) {
        log.exception(APP_NAME, `Unable to save 'config.json'`, err);
        return;
      }
      log.debug(APP_NAME, `Updated config saved to 'config.json'`);
    });
  });

  _fb.child('commands').on('child_added', function(snapshot) {
    const cmd = snapshot.val();
    try {
      if (cmd.hasOwnProperty('cmdName')) {
        _home.executeCommandByName(cmd.cmdName, cmd.modifier, 'FB');
      } else {
        _home.executeCommand(cmd, 'FB');
      }
    } catch (ex) {
      let msg = 'Unable to execute Firebase Command: ';
      msg += JSON.stringify(cmd);
      log.exception(APP_NAME, msg, ex);
    }
    snapshot.ref().remove();
  });

  Keypad.listen(_config.keypad.modifiers, _handleKeyPress);

  const cron15m = _getCronIntervalValue(15, 30);
  log.log(APP_NAME, `CRON_15 - ${Math.floor(cron15m / 1000)} seconds`);
  setInterval(function() {
    log.verbose(APP_NAME, 'CRON 15');
    _loadAndRunJS('cron15.js');
  }, cron15m);

  const cron60m = _getCronIntervalValue(60, 2 * 60);
  log.log(APP_NAME, `CRON_60 - ${Math.floor(cron60m / 1000)} seconds`);
  setInterval(function() {
    log.verbose(APP_NAME, 'CRON Hourly');
    _loadAndRunJS('cron60.js');
  }, cron60m);

  const cron24h = _getCronIntervalValue(24 * 60, 5 * 60);
  log.log(APP_NAME, `CRON_24 - ${Math.floor(cron24h / 1000)} seconds`);
  setInterval(function() {
    log.verbose(APP_NAME, 'CRON Daily');
    _loadAndRunJS('cronDaily.js');
  }, cron24h);
}


/**
 * Handles a key press
 *
 * @param {String} key Character hit by the user.
 * @param {String} modifier If a modifier is used.
 * @param {Boolean} exitApp If the app should exit.
 */
function _handleKeyPress(key, modifier, exitApp) {
  const details = {
    key: key,
    modifier: modifier,
    exitApp: exitApp,
  };
  log.verbose(APP_NAME, 'Key pressed', details);
  if (exitApp) {
    _close();
    _deviceMonitor.shutdown('USER', 'exit_key', 0);
    return;
  }
  const cmd = _config.keypad.keys[key];
  if (cmd && cmd.hasOwnProperty('cmdName')) {
    _home.executeCommandByName(cmd.cmdName, modifier, 'KEYPAD');
    return;
  }
  if (cmd) {
    _home.executeCommand(cmd, modifier, 'KEYPAD');
    return;
  }
}

/**
 * Generate the interval delay for the daily cron jobs.
 *
 * @param {Number} minutes How often the cron job should run, in minutes.
 * @param {Number} delaySeconds Add/subtract up to X number of delay seconds.
 * @return {Number} The number of milliseconds to wait between calls.
 */
function _getCronIntervalValue(minutes, delaySeconds) {
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
 * Load and run a JavaScript file.
 *   Used for the cron job system.
 *
 * @param {String} file The file to load and run.
 * @param {Function} [callback] Callback to run once completed.
*/
function _loadAndRunJS(file, callback) {
  let msg = `loadAndRunJS('${file}')`;
  log.debug(APP_NAME, msg);
  fs.readFile(file, function(err, data) {
    if (err) {
      log.exception(APP_NAME, msg + ' Unable to load file.', err);
      if (callback) {
        callback(err, file);
      }
    } else {
      try {
        eval(data.toString());
      } catch (ex) {
        log.exception(APP_NAME, msg + ' Exception on eval.', ex);
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

/**
 * Close any open connections to shutdown the controller.
*/
function _close() {
  log.log(APP_NAME, 'Preparing to exit, closing all connections...');
  if (_home) {
    _home.shutdown();
  }
  if (_httpServer) {
    _httpServer.shutdown();
  }
  if (_wss) {
    _wss.shutdown();
  }
}

process.on('SIGINT', function() {
  _close();
  _deviceMonitor.shutdown('SIGINT', 'shutdown_request', 0);
});

init();
