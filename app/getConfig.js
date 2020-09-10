'use strict';

/* node14_ready */

const fs = require('fs/promises');
const log = require('./SystemLog2');
const FBHelper = require('./FBHelper');

const LOG_PREFIX = 'GET_CONFIG';

/**
 * Main function
 */
async function go() {
  const appId = process.argv[2] || 'HomeOnNode';

  let config;
  try {
    const fbRootRef = await FBHelper.getRootRef(30 * 1000);
    const fbConfigRef = fbRootRef.child(`config/${appId}`);
    const fbConfigSnap = await fbConfigRef.once('value');
    config = fbConfigSnap.val();
  } catch (ex) {
    log.error(LOG_PREFIX, 'Unable to get config.', ex);
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
