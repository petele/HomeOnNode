'use strict';

const log = require('./SystemLog2');
const keypress = require('keypress');

const LOG_PREFIX = 'KEYPAD';

/**
 * Listen for key presses.
 *
 * @param {Object} modifiers Possible modifiers to use.
 * @param {Function} callback Callback to call when a key is pressed.
*/
function listen(modifiers, callback) {
  log.init(LOG_PREFIX, 'Init');
  let modifier = null;
  keypress(process.stdin);

  // listen for the 'keypress' event
  process.stdin.on('keypress', function(ch, key) {
    if ((key && key.ctrl && key.name === 'c') || (ch === 'q')) {
      callback(null, null, {exit: true});
      return;
    }

    if (ch === '\r') {
      ch = 'ENTER';
    } else if (ch === '\t') {
      ch = 'TAB';
    } else if (ch === '\x7f') {
      ch = 'BS';
    } else if (ch === '.') {
      ch = 'DOT';
    } else if (ch === '/') {
      ch = 'FW';
    } else if (ch === '#') {
      ch = 'HASH';
    } else if (ch === '$') {
      ch = 'DOLLAR';
    } else if (ch === '[') {
      ch = 'SQOPEN';
    } else if (ch === ']') {
      ch = 'SQCLOSE';
    } else if (ch === '\u001b') {
      ch = 'ESC';
    }
    try {
      ch = ch.toString();
      let m = modifiers[ch];
      if (m) {
        modifier = m;
        setTimeout(function() {
          modifier = null;
        }, 5000);
      } else if (ch) {
        callback(ch, modifier, null);
        modifier = null;
      }
    } catch (ex) {
      log.exception(LOG_PREFIX, 'Exception!', ex);
    }
  });

  process.stdin.setRawMode(true);
  process.stdin.resume();
}

exports.listen = listen;
