'use strict';

const fs = require('fs');
const request = require('request');
const log = require('./SystemLog2');
const fbHelper = require('./FBHelper');
const Keys = require('./Keys').keys;
const Keypad = require('./Keypad');

let config;
let cmdId = 0;

const APP_NAME = process.argv[2];
if (!APP_NAME) {
  log.error('REMOTE', 'App Name not provided on command line');
  process.exit(1);
}
log.setAppName(APP_NAME);
const logOpt = {
  firebaseLogLevel: 40,
  firebasePath: `logs/${APP_NAME.toLowerCase()}`,
};
log.setOptions(logOpt);
log.appStart();

const fb = fbHelper.init(Keys.firebase.appId, Keys.firebase.key, APP_NAME);
log.setFirebaseRef(fb);
fb.child(`config/${APP_NAME}/logs`).on('value', (snapshot) => {
  log.setOptions(snapshot.val());
  log.debug(APP_NAME, 'Log config updated.');
});

/**
 * Send a command
 *
 * @param {Object} command Command to send.
 * @param {String} path The URL path to send the command.
*/
function sendCommand(command, path) {
  const prefix = 'sendCommand (' + cmdId++ + ')';
  const url = `http://${config.controller.ip}:${config.controller.port}${path}`;
  const cmd = {
    uri: url,
    method: 'POST',
    json: true,
    body: command,
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

    const keypadConfigPath = `config/${APP_NAME}/keypad`;
    fb.child(keypadConfigPath).on('value', function(snapshot) {
      log.log(APP_NAME, 'Keypad settings updated.');
      config.keypad = snapshot.val();
    });

    if ((config.keypad) && (config.keypad.enabled === true)) {
      Keypad.listen(config.keypad.modifiers, function(key, modifier, exitApp) {
        if (exitApp) {
          exit('SIGINT', 0);
        } else {
          const cmd = config.keypad.keys[key];
          if (cmd) {
            cmd.modifier = modifier;
            let path = '/execute';
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

/**
 * Exit the app.
 *
 * @param {String} sender Who is requesting the app to exit.
 * @param {Number} exitCode The exit code to use.
*/
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
  log.cleanFile();
}, 60 * 60 * 24 * 1000);
