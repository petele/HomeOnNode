'use strict';

const os = require('os');
const Firebase = require('firebase');
const log = require('./SystemLog2');
const moment = require('moment');
const version = require('./version');
const exec = require('child_process').exec;

const LOG_PREFIX = 'FB_HELPER';

/**
 * Initalize the Firebase Wrapper
 *
 * @param {string} fbAppId The name of the Firebase App Id to use
 * @param {string} key The Firebase authoritzation custom token
 * @param {string} appName The appName of the current app for the heartbeat
 * @return {Object} The Firebase object to use.
 */
function init(fbAppId, key, appName) {
  log.init(LOG_PREFIX, fbAppId + ' for ' + appName);
  const timeFormat = 'YYYY-MM-DDTHH:mm:ss.SSS';
  const fbURL = `https://${fbAppId}.firebaseio.com/`;
  let fb = new Firebase(fbURL);

  fb.authWithCustomToken(key, function(error, authToken) {
    if (error) {
      log.exception(LOG_PREFIX, 'Firebase auth failed.', error);
    } else {
      log.log(LOG_PREFIX, 'Firebase auth success.', authToken);
    }
  });

  const now = Date.now();
  const startedAt = moment(now).format(timeFormat);
  let def = {
    appName: appName,
    startedAt: now,
    startedAt_: startedAt,
    heartbeat: now,
    heartbeat_: startedAt,
    version: version.head,
    online: true,
    shutdownAt: null,
    host: {
      hostname: null,
      ipAddress: null,
    },
  };

  let hostname = getHostname();
  if (hostname) {
    def.host.hostname = hostname;
  }
  let ipAddresses = getIPAddresses();
  if (ipAddresses.length >= 1) {
    def.host.ipAddress = ipAddresses[0];
  }

  fb.child(`devices/${appName}`).set(def);
  fb.child('.info/connected').on('value', function(snapshot) {
    if (snapshot.val() === true) {
      log.log(LOG_PREFIX, 'Connected.');
      const now = Date.now();
      const def = {
        heartbeat: now,
        heartbeat_: moment(now).format(timeFormat),
        online: true,
        shutdownAt: null,
      };
      fb.child(`devices/${appName}`).update(def);
      fb.child(`devices/${appName}/online`).onDisconnect().set(false);
      fb.child(`devices/${appName}/shutdownAt`).onDisconnect()
        .set(Firebase.ServerValue.TIMESTAMP);
    } else {
      log.warn(LOG_PREFIX, 'Disconnected.');
    }
  });

  setInterval(function() {
    let ipAddresses = getIPAddresses();
    if (ipAddresses.length >= 1) {
      fb.child(`devices/${appName}/host/ipAddress`).set(ipAddresses[0]);
    }
  }, 5 * 60 * 1000);

  setInterval(function() {
    const now = Date.now();
    fb.child(`devices/${appName}/heartbeat_`)
      .set(moment(now).format(timeFormat));
    fb.child(`devices/${appName}/heartbeat`).set(now);
  }, 1 * 60 * 1000);

  fb.child(`devices/${appName}/restart`).on('value', function(snapshot) {
    if (snapshot.val() === true) {
      snapshot.ref().remove();
      log.appStop(LOG_PREFIX, 'Restart requested via Firebase.');
      exec('sudo reboot', function(error, stdout, stderr) {});
    }
  });

  fb.child(`devices/${appName}/shutdown`).on('value', function(snapshot) {
    if (snapshot.val() === true) {
      snapshot.ref().remove();
      log.appStop(LOG_PREFIX, 'Shutdown requested via Firebase.');
      process.exit(0);
    }
  });

  return fb;
}

/**
 * Get Hostname of the local device.
 *
 * @return {string} The device hostname.
 */
function getHostname() {
  try {
    const hostname = os.hostname();
    log.log('NETWORK', `Hostname: ${hostname}`);
    return hostname;
  } catch (ex) {
    log.exception('NETWORK', 'Unable to retrieve hostname.', ex);
    return null;
  }
}

/**
 * Get a list of non-local IPv4 addresses for the current device.
 *
 * @return {Array} The list of non-local IPv4 addresses for the current device.
 */
function getIPAddresses() {
  try {
    let addresses = [];
    const interfaces = os.networkInterfaces();
    // eslint-disable-next-line guard-for-in
    for (const iface in interfaces) {
      // eslint-disable-next-line guard-for-in
      for (const iface2 in interfaces[iface]) {
        const address = interfaces[iface][iface2];
        if (address.family === 'IPv4' && !address.internal) {
          addresses.push(address.address);
        }
      }
    }
    return addresses;
  } catch (ex) {
    log.exception('NETWORK', 'Unable to get local device IP addresses', ex);
  }
  return [];
}

exports.init = init;
exports.getIPAddresses = getIPAddresses;
