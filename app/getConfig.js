'use strict';

/* node14_ready */

const fs = require('fs/promises');
const log = require('./SystemLog2');
const FBHelper = require('./FBHelper');

const LOG_PREFIX = 'GET_CONFIG';

log.setAppName(LOG_PREFIX);
log.appStart();

/**
 * Gets the config data from Firebase.
 *
 * @param {String} appID The path to the config file.
*/
async function _getConfigFromFB(appID) {
  log.log(LOG_PREFIX, 'Requesting config file...');
  const fbRef = await FBHelper.getRef(`config/${appID}`);
  if (!fbRef) {
    log.exception(LOG_PREFIX, 'Unable to get Firebase Ref');
    return;
  }
  const configSnap = await fbRef.once('value');
  const config = configSnap.val();
  return config;
}

/**
 * Returns a promise that is rejected after 45 seconds.
 *
 * @return {Promise<error>} Promise always rejects after 45 seconds.
 */
function timeout() {
  return new Promise((resolve, reject) => {
    setTimeout(() => {
      reject(new Error('timeout'));
    }, 45 * 1000);
  });
}

/**
 * Main function
 */
async function go() {
  const appId = process.argv[2] || 'HomeOnNode';
  const configPromise = _getConfigFromFB(appId);
  try {
    await Promise.race([configPromise, timeout()]);
  } catch (ex) {
    log.log(LOG_PREFIX, 'Timeout exceeded.', ex);
    process.exit(1);
  }

  const config = await configPromise;
  if (!config) {
    log.exception(LOG_PREFIX, 'No config data returned.');
    process.exit(1);
  }

  try {
    await fs.writeFile('config.json', JSON.stringify(config, null, 2));
    log.log(LOG_PREFIX, 'Config file saved to disk.');
    process.exit(0);
  } catch (ex) {
    log.exception(LOG_PREFIX, 'Unable to write config file.', ex);
    process.exit(1);
  }
}

go();
