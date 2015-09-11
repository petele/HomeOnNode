'use strict';

var log = require('./SystemLog');
var keypress = require('keypress');

function listen(modifiers, callback) {
  log.init('[KEYPAD]');
  var modifier = null;
  keypress(process.stdin);

  // listen for the 'keypress' event
  process.stdin.on('keypress', function(ch, key) {
    if ((key && key.ctrl && key.name === 'c') || (ch === 'q')) {
      callback(null, null, {exit: true});
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
      var m = modifiers[ch];
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
      log.exception('[KEYPAD]', ex);
    }
  });

  process.stdin.setRawMode(true);
  process.stdin.resume();
}

exports.listen = listen;
