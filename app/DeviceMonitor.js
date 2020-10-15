'use strict';

/* node14_ready */

const os = require('os');
const util = require('util');
const fs = require('fs/promises');
const fetch = require('node-fetch');
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
  const _deviceName = deviceName || 'DEVICE_MONITOR';
  const _self = this;
  let _fbRef;
  let _heartbeatInterval;
  let _ipAddressInterval;
  let _connectionCheckInterval;
  let _pingGoogleInterval;
  let _ipAddresses = [];
  let _disconnectedAt = null;
  let _lastGooglePing = Date.now();

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
    const piModel = await _getPiModelInfo();
    _ipAddresses = _getIPAddress();
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
        ipAddress: _ipAddresses,
        cpuModel: piModel,
      },
      restart: null,
      shutdown: null,
      exitDetails: null,
      argv: process.argv.join(' '),
      uptime: 0,
      uptime_: `starting...`,
    };
    const cpuTemp = await _getCPUTemperature();
    if (cpuTemp) {
      deviceData.host.cpuTemp = cpuTemp;
    }
    log.log(_deviceName, 'Device Settings', deviceData);
    await _fbRef.child(_deviceName).set(deviceData);
    _fbRef.root.child(`.info/connected`).on('value', _connectionChanged);
    _fbRef.child(`${_deviceName}/restart`).on('value', _restartRequest);
    _fbRef.child(`${_deviceName}/shutdown`).on('value', _shutdownRequest);
    _heartbeatInterval = setInterval(_tickHeartbeat, 1 * 60 * 1000);
    _ipAddressInterval = setInterval(_tickIPAddress, 15 * 60 * 1000);
    _connectionCheckInterval = setInterval(_tickConnectionCheck, 30 * 1000);
    _pingGoogleInterval = setInterval(_tickPingGoogle, 30 * 1000);
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
   * Get the RaspberryPi model info.
   */
  async function _getPiModelInfo() {
    try {
      const fileName = '/proc/device-tree/model';
      const model = await fs.readFile(fileName, {encoding: 'utf8'});
      return model.trim();
    } catch (ex) {
      return 'N/A';
    }
  }

  /**
   * Get the CPU temperature on a Raspberry Pi by reading
   * /sys/class/thermal/thermal_zone0/temp
   */
  async function _getCPUTemperature() {
    try {
      const fileName = '/sys/class/thermal/thermal_zone0/temp';
      const val = await fs.readFile(fileName, {encoding: 'utf8'});
      const temp = parseInt(val.trim(), 10) / 1000;
      return temp;
    } catch (ex) {
      return null;
    }
  }

  /**
   * Heartbeat Tick
   */
  function _tickHeartbeat() {
    if (!_fbRef) {
      log.error(_deviceName, 'No Firebase ref...');
      return;
    }
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
    _fbRef.child(_deviceName).update(details)
        .then(() => {
          return _getCPUTemperature();
        })
        .then((cpuTemp) => {
          if (cpuTemp) {
            return _fbRef.child(`${deviceName}/host/cpuTemp`).set(cpuTemp);
          }
        })
        .catch((err) => {
          log.error(_deviceName, 'Error updating heartbeat info', err);
        });
  }

  /**
   * Check when the last connection was.
   */
  function _tickConnectionCheck() {
    if (_disconnectedAt === null) {
      return;
    }
    const now = Date.now();
    const offlineFor = now - _disconnectedAt;
    log.log(_deviceName, `Disconnected for ${offlineFor / 1000}s`);
    _self.emit('disconnected', offlineFor);
  }

  /**
   * Pings google.com to verify connectivity...
   */
  async function _tickPingGoogle() {
    const offlineInfo = {};
    const fetchOpts = {
      method: 'GET',
      timeout: 5 * 1000,
    };
    try {
      await fetch('https://google.com/generate_204', fetchOpts);
      _lastGooglePing = Date.now();
      return;
    } catch (ex) {
      offlineInfo.ex = {
        name: ex.name,
        message: ex.message,
      };
      log.verbose(_deviceName, `Unable to ping google.com`, ex);
    }
    offlineInfo.offlineFor = Date.now() - _lastGooglePing;
    const cpuTemp = await _getCPUTemperature();
    if (cpuTemp) {
      offlineInfo.cpuTemp = `${cpuTemp}°C`;
    }
    log.warn(_deviceName, `Offline`, offlineInfo);
    _self.emit('offline', offlineInfo);
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
    const isConnected = snapshot.val();
    if (isConnected === false) {
      log.warn(_deviceName, 'Disconnected from Firebase.');
      _disconnectedAt = Date.now();
      return;
    }
    log.log(_deviceName, 'Connected to Firebase.');
    _disconnectedAt = null;
    const now = Date.now();
    const uptime = process.uptime();
    const uptime_ = log.humanizeDuration(uptime);
    const details = {
      heartbeat: now,
      heartbeat_: log.formatTime(now),
      online: true,
      shutdownAt: null,
      exitDetails: null,
      uptime: uptime,
      uptime_: uptime_,
    };
    _fbRef.child(`${_deviceName}`).update(details);
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
    if (_connectionCheckInterval) {
      clearInterval(_connectionCheckInterval);
      _connectionCheckInterval = null;
    }
    if (_pingGoogleInterval) {
      clearInterval(_pingGoogleInterval);
      _pingGoogleInterval = null;
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
  this.shutdown = async function(sender, reason, exitCode) {
    const exitDetails = {
      shutdown: true,
      sender: sender,
      reason: reason,
      exitCode: exitCode,
    };
    const withTimeout = [
      _beforeExit(exitDetails),
      honHelpers.sleep(30 * 1000),
    ];
    await Promise.race(withTimeout);
    process.exit(exitCode);
  };

  /**
   * Restarts the computer
   *
   * @param {String} sender Who requested the restart.
   * @param {String} reason The reason the device is being shutdown.
   * @param {Boolean} immediate if the reboot should happen immediately.
   */
  this.restart = async function(sender, reason, immediate) {
    const exitDetails = {
      restart: true,
      sender: sender,
      reason: reason,
      immediate: immediate,
    };
    const withTimeout = [
      _beforeExit(exitDetails),
      honHelpers.sleep(30 * 1000),
    ];
    await Promise.race(withTimeout);
    const timeout = immediate ? 1 : RESTART_TIMEOUT;
    log.debug(_deviceName, `Will reboot in ${timeout} ms...`);
    setTimeout(() => {
      exec('sudo reboot', function(error, stdout, stderr) {});
    }, timeout);
  };

  _init();
}
util.inherits(DeviceMonitor, EventEmitter);

module.exports = DeviceMonitor;
