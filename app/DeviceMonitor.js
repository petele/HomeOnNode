'use strict';

/* node14_ready */

const os = require('os');
const util = require('util');
const log = require('./SystemLog2');
const version = require('./version');
const diff = require('deep-diff').diff;
const FBHelper = require('./FBHelper');
const honHelpers = require('./HoNHelpers');
const exec = require('child_process').exec;
const EventEmitter = require('events').EventEmitter;

/**
 * Device Monitor API
 * @constructor
 *
 * @fires DeviceMonitor#error
 * @fires DeviceMonitor#restart_request
 * @fires DeviceMonitor#shutdown_request
 * @fires DeviceMonitor#connection_timedout
 * @param {String} deviceName Name of the device.
 * @param {Boolean} isMonitor
*/
function DeviceMonitor(deviceName, isMonitor) {
  const RESTART_TIMEOUT = 2500;
  const MAX_DISCONNECT = 12 * 60 * 60 * 1000;
  const _deviceName = deviceName || 'DEVICE_MONITOR';
  const _self = this;
  let _fbRef;
  let _heartbeatInterval;
  let _ipAddressInterval;
  let _lastWrite = Date.now();
  let _hasExceededTimeout = false;
  let _firstConnect = true;
  let _ipAddresses = [];

  /**
   * Init the DeviceMonitor
  */
  async function _init() {
    log.init('DeviceMonitor', 'Starting...');
    const fbPath = isMonitor === true ? 'monitor' : 'devices';
    const fbRoot = await FBHelper.getRootRefUnlimited();
    _fbRef = await fbRoot.child(fbPath);
    if (!deviceName) {
      log.error(_deviceName, 'deviceName not provided.');
      _self.emit('error', 'no_device_name');
      return;
    }
    const now = Date.now();
    const now_ = log.formatTime(now);
    const lastIndexOf = process.argv[1].lastIndexOf('/') + 1;
    const appName = process.argv[1].substring(lastIndexOf).replace('.js', '');
    const deviceData = {
      deviceName: _deviceName,
      appName: appName,
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
        hostname: honHelpers.getHostname(),
        ipAddress: _getIPAddress(),
      },
      restart: null,
      shutdown: null,
      exitDetails: null,
      argv: process.argv.join(' '),
      uptime: 0,
      uptime_: `starting...`,
    };
    _ipAddresses = deviceData.host.ipAddress;
    log.log(_deviceName, 'Device Settings', deviceData);
    _lastWrite = now;
    _fbRef.child(_deviceName).set(deviceData);
    _fbRef.root.child(`.info/connected`).on('value', _connectionChanged);
    _fbRef.child(`${_deviceName}/restart`).on('value', _restartRequest);
    _fbRef.child(`${_deviceName}/shutdown`).on('value', _shutdownRequest);
    _getPiModelInfo();
    _heartbeatInterval = setInterval(_tickHeartbeat, 1 * 60 * 1000);
    _ipAddressInterval = setInterval(_tickIPAddress, 15 * 60 * 1000);
    _initUncaught();
    _initUnRejected();
    _initWarning();
  }

  /**
   * Setup the Uncaught Exception Handler
   */
  function _initUncaught() {
    process.on('uncaughtException', (err) => {
      log.fatal(_deviceName, 'A fatal exception occured.', err);
      setTimeout(() => {
        console.log('--FORCED EXIT--');
        console.log(err);
        console.log('--FORCED EXIT--');
        process.exit(1);
      }, RESTART_TIMEOUT);
    });
  }

  /**
   * Setup the Unhandled Rejection Handler
   */
  function _initUnRejected() {
    process.on('unhandledRejection', (reason, p) => {
      console.log(reason);
      log.warn(_deviceName, 'An unhandled promise rejection occured.', reason);
    });
  }

  /**
   * Setup the Warning Handler
   */
  function _initWarning() {
    process.on('warning', (warning) => {
      log.warn(_deviceName, 'Node warning', warning);
    });
  }

  /**
   * Refreshes the stored IP address
   */
  function _tickIPAddress() {
    const ipAddresses = _getIPAddress();
    if (diff(ipAddresses, _ipAddresses)) {
      _ipAddresses = ipAddresses;
      log.verbose(_deviceName, `IP addresses changed`, _ipAddresses);
      _fbRef.child(`${_deviceName}/host/ipAddress`).set(_ipAddresses)
          .catch((err) => {
            log.error(_deviceName, 'Unable to store IP address.', err);
          });
    }
  }

  /**
   *
   */
  function _getPiModelInfo() {
    log.todo(_deviceName, 'Change getPiModelInfo and readFile');
    _readFile('/proc/device-tree/model')
        .then((contents) => {
          if (contents) {
            log.log(_deviceName, 'CPU Model', contents);
            return _fbRef.child(`${_deviceName}/host/cpuModel`).set(contents);
          }
        })
        .catch((err) => {});
  }

  /**
   * Reads a file from the local file system.
   *
   * @param {String} filePath
   * @return {Promise}
   */
  function _readFile(filePath) {
    return new Promise((resolve, reject) => {
      exec(`cat ${filePath}`, (err, stdOut, stdErr) => {
        if (err) {
          log.error(_deviceName, `readFile failed for ${filePath}`, err);
          reject(err);
          return;
        }
        if (stdErr) {
          const msg = `readFile failed for ${filePath} (stdErr)`;
          log.error(_deviceName, msg, stdErr);
          reject(new Error('std_err'));
          return;
        }
        resolve(stdOut);
      });
    });
  }


  /**
   * Heartbeat Tick
   */
  function _tickHeartbeat() {
    const now = Date.now();
    const now_ = log.formatTime(now);
    const uptime = process.uptime();
    const uptime_ = log.humanizeDuration(uptime);
    const details = {
      heartbeat: now,
      heartbeat_: now_,
      online: true,
      shutdownAt: null,
      exitDetails: null,
      uptime: uptime,
      uptime_: uptime_,
    };
    if (!_fbRef) {
      log.error(_deviceName, 'No Firebase ref...');
      return;
    }
    _fbRef.child(`${_deviceName}`).update(details, (err) => {
      if (err) {
        log.error(_deviceName, 'Error updating heartbeat info', err);
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
      log.warn(_deviceName, 'Time since last successful write exceeded.', info);
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
      log.verbose(_deviceName, 'Restart requested via FB.');
      snapshot.ref.remove();
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
      log.verbose(_deviceName, 'Shutdown requested via FB.');
      snapshot.ref.remove();
      _self.emit('shutdown_request');
    }
  }

  /**
   * Handles a Firebase connection state change.
   *
   * @param {Object} snapshot Firebase snapshot.
   */
  function _connectionChanged(snapshot) {
    if (_firstConnect) {
      _firstConnect = false;
      return;
    }
    const isConnected = snapshot.val();
    if (isConnected === false) {
      log.warn(_deviceName, 'Disconnected from Firebase.');
      return;
    }
    log.log(_deviceName, 'Connected to Firebase.');
    const now = Date.now();
    const details = {
      heartbeat: now,
      heartbeat_: log.formatTime(now),
      online: true,
      shutdownAt: null,
      exitDetails: null,
    };
    _fbRef.child(`${_deviceName}`)
        .update(details);
    _fbRef.child(`${_deviceName}/online`)
        .onDisconnect()
        .set(false);
    _fbRef.child(`${_deviceName}/shutdownAt`)
        .onDisconnect()
        .set(FBHelper.getServerTimeStamp());
  }

  /**
   * Get's the primary IP address from the device.
   *
   * @return {Array} An array of IP address of the device.
   */
  function _getIPAddress() {
    const addresses = [];
    try {
      const interfaces = os.networkInterfaces();
      // eslint-disable-next-line guard-for-in
      for (const iface in interfaces) {
        // eslint-disable-next-line guard-for-in
        for (const iface2 in interfaces[iface]) {
          const address = interfaces[iface][iface2];
          if (!address.internal) {
            addresses.push(address.address);
            log.verbose(_deviceName, `IP Address: ${address.address}`);
          }
        }
      }
    } catch (ex) {
      log.exception(_deviceName, 'Unable to get local device IP addresses', ex);
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
    return _fbRef.child(`${_deviceName}`).update(details);
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
    _beforeExit(exitDetails).then(() => {
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
    _beforeExit(exitDetails).then(() => {
      let timeout = 0;
      if (immediate !== true) {
        timeout = RESTART_TIMEOUT;
        log.debug(_deviceName, `Will reboot in ${timeout} ms...`);
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
