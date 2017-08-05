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
  const MAX_DISCONNECT = 2 * 60 * 1000;
  const _fb = fb;
  const _deviceName = deviceName;
  const _self = this;
  let _ipAddresses;
  let _heartbeatInterval;
  let _ipAddressInterval;
  let _lastWrite;
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
      shutdownBy: null,
      startedAt: now,
      startedAt_: now_,
      host: {
        hostname: _getHostname(),
        ipAddress: _ipAddresses,
      },
      restart: null,
      shutdown: null,
    };
    _lastWrite = now;
    _fb.child(_deviceName).set(deviceData);
    _fb.root().child(`.info/connected`).on('value', _connectionChanged);
    _fb.child(`${_deviceName}/restart`).on('value', _restartRequest);
    _fb.child(`${_deviceName}/shutdown`).on('value', _shutdownRequest);
    _heartbeatInterval = setInterval(_tickIPAddress, 15 * 60 * 1000);
    _ipAddressInterval = setInterval(_tickHeartbeat, 1 * 60 * 1000);
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
      shutdownBy: null,
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
      log.warn(LOG_PREFIX, 'Time since last successful write exceeded.');
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
      log.verbose(LOG_PREFIX, 'Restart requested.');
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
      log.verbose(LOG_PREFIX, 'Shutdown requested.');
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
      shutdownBy: null,
    };
    _fb.child(`${_deviceName}`).update(details);
    _fb.child(`${_deviceName}/online`).onDisconnect().set(false);
    _fb.child(`${_deviceName}/shutdownBy`).onDisconnect()
      .set('connection_lost');
    _fb.child(`${_deviceName}/shutdownAt`).onDisconnect()
      .set(Firebase.ServerValue.TIMESTAMP);
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
   * @param {String} reason The reason the device is being shutdown.
   */
  this.shutdown = function(reason) {
    log.log(LOG_PREFIX, 'Shutting down...', {reason: reason});
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
      shutdownBy: reason,
    };
    _fb.child(`${_deviceName}`).update(details);
  };

  /**
   * Restarts the computer
   */
  this.restart = function() {
    log.warn(LOG_PREFIX, 'Restarting now...');
    exec('sudo reboot', function(error, stdout, stderr) {});
  };


  _init();
}
util.inherits(DeviceMonitor, EventEmitter);

module.exports = DeviceMonitor;
