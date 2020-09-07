'use strict';

/* node14_ready */

const util = require('util');
const fs = require('fs');
const log = require('./SystemLog2');
const FBHelper = require('./FBHelper');
const deepDiff = require('deep-diff').diff;
const EventEmitter = require('events').EventEmitter;

const LOG_PREFIX = 'Config_Helper';

/**
 * Config Helper
 * @constructor
*/
function ConfigHelper() {
  const _self = this;
  let _config;

  /**
   * Initialize the config helper, and read the config from disk.
   */
  function init() {
    let data;
    try {
      log.debug(LOG_PREFIX, `Reading 'config.json'.`);
      data = fs.readFileSync('config.json', {encoding: 'utf8'});
    } catch (ex) {
      const msg = `Error reading 'config.json' file.`;
      log.exception(LOG_PREFIX, msg, ex);
    }

    try {
      log.debug(LOG_PREFIX, `Parsing 'config.json'.`);
      _config = JSON.parse(data);
    } catch (ex) {
      const msg = `Error parsing 'config.json' file.`;
      log.exception(LOG_PREFIX, msg, ex);
    }

    _initFBConfig();
  }

  /**
   * Return the current config object.
   *
   * @return {Object}
   */
  this.getConfig = function() {
    return _config;
  };

  /**
   * Setup the Firebase config listener.
   */
  async function _initFBConfig() {
    const fbConfigRef = await FBHelper.getRef(`config/HomeOnNode`);
    fbConfigRef.on('value', (snapshot) => {
      const newConfig = snapshot.val();
      if (!deepDiff(_config, newConfig)) {
        return;
      }
      _config = newConfig;
      _self.emit('changed', _config);
      _writeConfigToDisk();
    });
  }

  /**
   * Write the current config object to disk.
   */
  function _writeConfigToDisk() {
    fs.writeFile('config.json', JSON.stringify(_config, null, 2), (err) => {
      if (err) {
        log.exception(LOG_PREFIX, `Unable to save 'config.json'`, err);
        return;
      }
      log.debug(LOG_PREFIX, `Updated config saved to 'config.json'`);
    });
  }

  init();
}

util.inherits(ConfigHelper, EventEmitter);

module.exports = ConfigHelper;

