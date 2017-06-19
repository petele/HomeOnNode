'use strict';

const fs = require('fs');
const util = require('util');
const Keys = require('./Keys').keys;
const Firebase = require('firebase');
const log = require('./SystemLog2');

/**
 * Reboot the device.
 *
 * @param {String} path Firebase path of the logs to print.
*/
function getState(path) {
  fb.child(path).once('value', function(snapshot) {
    const state = snapshot.val();
    const opts = {colors: true, depth: 5, breakLength: 140};
    // eslint-disable-next-line no-console
    console.log(util.inspect(state, opts));
    fs.writeFileSync('state.json', JSON.stringify(state, null, 2));
    process.exit(0);
  });
}

const fb = new Firebase(`https://${Keys.firebase.appId}.firebaseio.com/`);
fb.authWithCustomToken(Keys.firebase.key, function(error, authToken) {
  if (error) {
    log.exception('GET_STATE', 'Firebase auth failed.', error);
  } else {
    log.log('GET_STATE', 'Firebase auth success.');
    const path = 'state/' + (process.argv[2] || '');
    log.log('GET_STATE', `${path}`);
    getState(`${path}`);
  }
});
