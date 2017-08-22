'use strict';

const os = require('os');
const util = require('util');
const log = require('./SystemLog2');
const version = require('./version');
const Firebase = require('firebase');
const exec = require('child_process').exec;
const EventEmitter = require('events').EventEmitter;

const LOG_PREFIX = 'DEVICE';

/**
 * Device Monitor API
 * @constructor
 *
 * @fires DeviceMonitor#error
 * @fires DeviceMonitor#restart_request
 * @fires DeviceMonitor#shutdown_request
 * @fires DeviceMonitor#connection_timedout
 * @param {Object} fb Firebase Object Reference.
 * @param {String} deviceName Name of the device.
*/
function DeviceMonitor(fb, deviceName) {
  const RESTART_TIMEOUT = 2500;
  const MAX_DISCONNECT = 12 * 60 * 60 * 1000;
  const _fb = fb;
  const _deviceName = deviceName;
  const _self = this;
  let _ipAddresses;
  let _heartbeatInterval;
  let _ipAddressInterval;
  let _lastWrite = Date.now();
  let _hasExceededTimeout = false;

  /**
   * Init the DeviceMonitor
  */
  function _init() {
    if (!_fb) {
      log.error(LOG_PREFIX, 'Firebase reference not provided.');
      _self.emit('error', 'no_firebase_ref');
      return;
    }
    if (!_deviceName) {
      log.error(LOG_PREFIX, 'deviceName not provided.');
      _self.emit('error', 'no_device_name');
      return;
    }
    const now = Date.now();
    const now_ = log.formatTime(now);
    _ipAddresses = _getIPAddress();
    const deviceData = {
      appName: _deviceName,
      heartbeat: now,
      heartbeat_: now_,
      version: version.head,
      online: true,
      shutdownAt: null,
      startedAt: now,
      startedAt_: now_,
      host: {
        architecture: os.arch(),
        cpus: os.cpus(),
        platform: os.platform(),
        release: os.release(),
        type: os.type(),
        hostname: _getHostname(),
        ipAddress: _ipAddresses,
      },
      restart: null,
      shutdown: null,
      exitDetails: null,
    };
    _lastWrite = now;
    _fb.child(_deviceName).set(deviceData);
    _fb.root().child(`.info/connected`).on('value', _connectionChanged);
    _fb.child(`${_deviceName}/restart`).on('value', _restartRequest);
    _fb.child(`${_deviceName}/shutdown`).on('value', _shutdownRequest);
    _fb.root().onAuth(_authChanged);
    _heartbeatInterval = setInterval(_tickIPAddress, 15 * 60 * 1000);
    _ipAddressInterval = setInterval(_tickHeartbeat, 1 * 60 * 1000);
    _initUncaught();
    _initUnRejected();
  }

  /**
   * Setup the Uncaught Exception Handler
   */
  function _initUncaught() {
    process.on('uncaughtException', (err) => {
      log.fatal(_deviceName, 'A fatal exception occured.', err);
      setTimeout(() => {
        process.exit(1);
      }, RESTART_TIMEOUT);
    });
  }

  /**
   * Setup the Unhandled Rejection Handler
   */
  function _initUnRejected() {
    process.on('unhandledRejection', (reason, p) => {
      log.warn(_deviceName, 'An unhandled promise rejection occured.', reason);
    });
  }

  /**
   * Refreshes the stored IP address
   */
  function _tickIPAddress() {
    fb.child(`${_deviceName}/host/ipAddress`).set(_getIPAddress());
  }

  /**
   * Heartbeat Tick
   */
  function _tickHeartbeat() {
    const now = Date.now();
    const now_ = log.formatTime(now);
    const details = {
      heartbeat: now,
      heartbeat_: now_,
      online: true,
      shutdownAt: null,
      exitDetails: null,
    };
    _fb.child(`${_deviceName}`).update(details, (err) => {
      if (err) {
        log.error(LOG_PREFIX, 'Error updating heartbeat info', err);
        return;
      }
      _hasExceededTimeout = false;
      _lastWrite = Date.now();
    });
    const timeSinceLastWrite = now - _lastWrite;
    if (timeSinceLastWrite > MAX_DISCONNECT && _hasExceededTimeout === false) {
      _hasExceededTimeout = true;
      const info = {
        now: now,
        msSinceLastWrite: timeSinceLastWrite,
        maxDisconnect: MAX_DISCONNECT,
      };
      log.warn(LOG_PREFIX, 'Time since last successful write exceeded.', info);
      _self.emit('connection_timedout');
    }
  }

  /**
   * Handles a Firebase restart request
   *
   * @param {Object} snapshot Firebase snapshot.
   */
  function _restartRequest(snapshot) {
    if (snapshot.val() === true) {
      log.verbose(LOG_PREFIX, 'Restart requested via FB.');
      snapshot.ref().remove();
      _self.emit('restart_request', RESTART_TIMEOUT);
    }
  }

  /**
   * Handles a Firebase shutdown request
   *
   * @param {Object} snapshot Firebase snapshot.
   */
  function _shutdownRequest(snapshot) {
    if (snapshot.val() === true) {
      log.verbose(LOG_PREFIX, 'Shutdown requested via FB.');
      snapshot.ref().remove();
      _self.emit('shutdown_request');
    }
  }

  /**
   * Handles a Firebase connection state change.
   *
   * @param {Object} snapshot Firebase snapshot.
   */
  function _connectionChanged(snapshot) {
    const isConnected = snapshot.val();
    if (isConnected === false) {
      log.warn(LOG_PREFIX, 'Disconnected from Firebase.');
      return;
    }
    log.log(LOG_PREFIX, 'Connected to Firebase.');
    const now = Date.now();
    const details = {
      heartbeat: now,
      heartbeat_: log.formatTime(now),
      online: true,
      shutdownAt: null,
      exitDetails: null,
    };
    _fb.child(`${_deviceName}`).update(details);
    _fb.child(`${_deviceName}/online`).onDisconnect().set(false);
    _fb.child(`${_deviceName}/shutdownAt`).onDisconnect()
      .set(Firebase.ServerValue.TIMESTAMP);
  }

  /**
   * Handles a Firebase authentication state change.
   *
   * @param {Object} authData Firebase authentication data.
   */
  function _authChanged(authData) {
    if (authData) {
      log.log(LOG_PREFIX, 'Firebase client authenticated.', authData);
      return;
    }
    log.warn(LOG_PREFIX, 'Firebase client unauthenticated.');
  }


  /**
   * Get's the hostname from the device.
   *
   * @return {String} The hostname of the device.
   */
  function _getHostname() {
    try {
      const hostname = os.hostname();
      log.log(LOG_PREFIX, `Hostname: ${hostname}`);
      return hostname;
    } catch (ex) {
      log.exception(LOG_PREFIX, `Unable to retreive hostname.`, ex);
      return 'unknown';
    }
  }

  /**
   * Get's the primary IP address from the device.
   *
   * @return {Array} An array of IP address of the device.
   */
  function _getIPAddress() {
    let addresses = [];
    try {
      const interfaces = os.networkInterfaces();
      // eslint-disable-next-line guard-for-in
      for (const iface in interfaces) {
        // eslint-disable-next-line guard-for-in
        for (const iface2 in interfaces[iface]) {
          const address = interfaces[iface][iface2];
          if (!address.internal) {
            addresses.push(address.address);
            log.verbose(LOG_PREFIX, `IP Address: ${address.address}`);
          }
        }
      }
    } catch (ex) {
      log.exception(LOG_PREFIX, 'Unable to get local device IP addresses', ex);
    }
    return addresses;
  }

  /**
   * Shuts down the Firebase device logging info
   *
   * @param {Object} exitDetails The details about the exiting the app.
   * @return {Promise} called when synchronization to the Firebase servers has
   *   completed.
   */
  function _beforeExit(exitDetails) {
    log.appStop(exitDetails.sender, exitDetails);
    if (_heartbeatInterval) {
      clearInterval(_heartbeatInterval);
      _heartbeatInterval = null;
    }
    if (_ipAddressInterval) {
      clearInterval(_ipAddressInterval);
      _ipAddressInterval = null;
    }
    const now = Date.now();
    const details = {
      online: false,
      shutdownAt: now,
      exitDetails: exitDetails,
    };
    return _fb.child(`${_deviceName}`).update(details);
  }

  /**
   * Shuts down the Firebase device logging info
   *
   * @param {String} sender The requestor that initiated the shutdown.
   * @param {String} reason The reason the device is being shutdown.
   * @param {Number} exitCode The exit code to exit with.
   */
  this.shutdown = function(sender, reason, exitCode) {
    const exitDetails = {
      shutdown: true,
      sender: sender,
      reason: reason,
      exitCode: exitCode,
    };
    _beforeExit(exitDetails)
    .then(() => {
      process.exit(exitCode);
    });
  };

  /**
   * Restarts the computer
   *
   * @param {String} sender Who requested the restart.
   * @param {String} reason The reason the device is being shutdown.
   * @param {Boolean} immediate if the reboot should happen immediately.
   */
  this.restart = function(sender, reason, immediate) {
    const exitDetails = {
      restart: true,
      sender: sender,
      reason: reason,
      immediate: immediate,
    };
    _beforeExit(exitDetails)
    .then(() => {
      let timeout = 0;
      if (immediate !== true) {
        timeout = RESTART_TIMEOUT;
        log.debug(LOG_PREFIX, `Will reboot in ${timeout} ms...`);
      }
      setTimeout(() => {
        exec('sudo reboot', function(error, stdout, stderr) {});
      }, timeout);
    });
  };

  _init();
}
util.inherits(DeviceMonitor, EventEmitter);

module.exports = DeviceMonitor;
