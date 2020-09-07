'use strict';

/* node14_ready */

const fs = require('fs');
const log = require('./SystemLog2');
const version = require('./version');
const diff = require('deep-diff').diff;

const LOG_PREFIX = 'State_Helper';

let _lastState;
const STATE_KEYS_TO_SAVE = ['doNotDisturb', 'systemState', 'hasNotifications'];


/**
 * Gets the saved state data.
 *
 * @return {Object} state object read from disk.
 */
function _getState() {
  let data;
  try {
    log.debug(LOG_PREFIX, `Reading 'state.json'`);
    data = fs.readFileSync('state.json', {encoding: 'utf8'});
  } catch (ex) {
    const msg = `Error reading 'state.json' file.`;
    log.exception(LOG_PREFIX, msg, ex);
    data = '{}';
  }

  let state = {};
  try {
    log.debug(LOG_PREFIX, `Parsing 'state.json'.`);
    state = JSON.parse(data);
  } catch (ex) {
    const msg = `Error parsing 'state.json' file.`;
    log.exception(LOG_PREFIX, msg, ex);
    state = {};
  }

  // const message = Object.assign({}, srcMessage);
  _lastState = Object.assign({}, state);

  state.gitHead = version.head;
  return state;
}

/**
 *
 * @param {Object} state
 */
function _writeState(state) {
  const newState = {};
  STATE_KEYS_TO_SAVE.forEach((key) => {
    newState[key] = state[key];
  });
  if (!diff(_lastState, newState)) {
    return;
  }
  _lastState = newState;
  const stateStr = JSON.stringify(newState, null, 2);
  fs.writeFile('state.json', stateStr, (err) => {
    if (err) {
      log.exception(LOG_PREFIX, `Unable to save 'state.json'`, err);
      return;
    }
    log.debug(LOG_PREFIX, `Updated state saved to 'state.json'`);
  });
}


exports.getState = _getState;
exports.writeState = _writeState;
