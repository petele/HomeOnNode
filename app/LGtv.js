'use strict';

const util = require('util');
const log = require('./SystemLog2');
const honHelpers = require('./HoNHelpers');
const EventEmitter = require('events').EventEmitter;

const LOG_PREFIX = 'LG_TV';
const LG_URLS = {
  apps: {
    appStatus: 'com.webos.service.appstatus/getAppStatus',
    foregroundAppInfo: 'com.webos.applicationManager/getForegroundAppInfo',
    getAppState: 'system.launcher/getAppState',
    launchPoints: 'com.webos.applicationManager/listLaunchPoints',
    launch: 'system.launcher/launch',
    open: 'system.launcher/open',
    close: 'system.launcher/close',
  },
  createToast: 'system.notifications/createToast',
  get: {
    servicesList: 'api/getServiceList',
    systemInfo: 'system/getSystemInfo',
    externalInputList: 'tv/getExternalInputList',
    swInfo: 'com.webos.service.update/getCurrentSWInformation',
    currentChannel: 'tv/getCurrentChannel',
  },
  mediaControls: {
    play: 'media.controls/play',
    pause: 'media.controls/pause',
    stop: 'media.controls/stop',
    rewind: 'media.controls/rewind',
    fastForward: 'media.controls/fastForward',
  },
  pointer: {
    getSocket: 'com.webos.service.networkinput/getPointerInputSocket',
  },
  power: {
    off: 'system/turnOff',
    on: 'system/turnOn',
    state: 'com.webos.service.tvpower/power/getPowerState',
  },
  switchInput: 'tv/switchInput',
  volume: {
    get: 'audio/getVolume',
    down: 'audio/volumeDown',
    mute: 'audio/setMute',
    set: 'audio/setVolume',
    status: 'audio/getStatus',
    up: 'audio/volumeUp',
    soundOutput: 'com.webos.service.apiadapter/audio/getSoundOutput',
  },
};
const LG_BUTTONS = [
  'MUTE', 'VOLUMEUP', 'VOLUMEDOWN',
  'RED', 'GREEN', 'YELLOW', 'BLUE',
  'CHANNELUP', 'CHANNELDOWN',
  '*', 'DASH', 'CC',
  'HOME', 'MENU', 'EXIT', 'BACK',
  'UP', 'DOWN', 'LEFT', 'RIGHT',
  'ENTER', 'CLICK',
  '0', '1', '2', '3', '4', '5', '6', '7', '8', '9',
];

/**
 * LG TV API.
 * @constructor
 *
 * @see https://github.com/hobbyquaker/lgtv2
 *
 * @property {Object}  state
 * @property {Boolean} state.connected Connected to TV
 * @property {Boolean} state.ready Initial setup completed
 * @property {Object}  state.systemInfo
 * @property {Object}  state.swInfo
 * @property {Array}   state.services List of services available
 * @property {Array}   state.launchPoints
 * @property {Array}   state.inputs List of available inputs
 * @property {Object}  state.powerState
 * @property {String}  state.currentAppId
 * @property {Number}  state.volume
 * @property {Boolean} state.muted
 * @property {Number}  state.currentChannel
 *
 * @param {String} ipAddress IP Address of the TV.
 * @param {Object} credentials Login credentials.
*/
function LGTV(ipAddress, credentials) {
  // IP Address, Port & Connection Options
  const _port = 3000;
  const _ipAddress = ipAddress;
  const RECONNECT_DELAY = 45 * 1000;
  const _connectionOptions = {
    url: `ws://${_ipAddress}:${_port}`,
    saveKey: _saveKey,
    clientKey: credentials,
    reconnect: RECONNECT_DELAY,
  };

  //  LGTV & Pointer Input Socket
  let _lgtv;
  let _pointerInputSocket;
  let _connectionStarted = false;

  // LG TV State Info
  this.state = {
    connected: false,
    ready: false,

    systemInfo: null,
    swInfo: null,
    services: [],
    launchPoints: [],
    inputs: [],
    powerState: null,
    currentAppInfo: null,

    volume: null,
    muted: false,
    soundOutput: null,

    currentChannel: null,

    currentAppId: null,
  };

  const _self = this;

  this.connect = async function() {
    if (_lgtv) {
      return true;
    }
    if (_connectionStarted) {
      log.warn(LOG_PREFIX, 'Connection attempt already in progress...');
      return false;
    }
    _connectionStarted = true;
    log.init(LOG_PREFIX, 'Connecting...');
    await honHelpers.waitForAlive(_ipAddress, _port);
    _lgtv = require('lgtv2')(_connectionOptions);
    _lgtv.on('error', _onError);
    _lgtv.on('prompt', _onPrompt);
    _lgtv.on('connect', _onConnect);
    _lgtv.on('connecting', _onConnecting);
    _lgtv.on('close', _onClose);
  };


  /** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** **
   * Public methods
   ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** */

  /**
   * Close the connection and shut down, do not reconnect.
   */
  this.shutdown = function() {
    _setState('ready', false);
    if (_lgtv) {
      _lgtv.disconnect();
    }
  };

  /**
   * Execute a LG TV command.
   *
   * @param {Object} command The command to run.
   * @param {String} command.action Name of action to run.
   * @param {*} [command.value] Value of the command
   * @return {Promise} The promise that will be resolved on completion.
  */
  this.executeCommand = function(command) {
    // Ensure we're connected
    if (_self.state.connected !== true) {
      log.error(LOG_PREFIX, `Not connected`);
      return Promise.reject(new Error('Not Connected'));
    }

    // Get & validate the action & value
    const action = command.action;
    const value = command.value;
    if (!action) {
      return Promise.reject(new Error(`No 'action' provided.`));
    }

    log.verbose(LOG_PREFIX, `executeCommand('${action}')`, value);

    // Run the commands
    if (action === 'showToast') {
      return _showToast(value);
    }
    if (action === 'launch') {
      return _launchApp(value);
    }
    if (action === 'setInput') {
      return _setInput(value);
    }
    if (action === 'setVolume') {
      return _setVolume(value);
    }
    if (action === 'setMute') {
      return _setMute(value);
    }
    if (action === 'volUp' || action === 'volumeUp') {
      return _sendRequest(LG_URLS.volume.up);
    }
    if (action === 'volDown' || action === 'volumeDown') {
      return _sendRequest(LG_URLS.volume.down);
    }
    if (action === 'sendButton') {
      return _sendButton(value);
    }
    if (action === 'mouseMove') {
      return _moveMouse(value);
    }
    if (action === 'mouseClick') {
      return _sendButton('CLICK');
    }
    if (action === 'closeApp') {
      return _closeApp();
    }
    if (action === 'mediaCommand') {
      return _sendMediaCommand(value);
    }

    return Promise.reject(new Error(`Unknown command: '${action}'`));
  };


  /** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** **
   * Reconnection Handlers
   ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** */

  // /**
  //  * Checks if the app is connected and attempts to reconnect if not.
  //  */
  // function _checkConnectionStateTick() {
  //   if (_self.state.connected || _connecting) {
  //     return;
  //   }
  //   if (_reconnect === false) {
  //     return;
  //   }
  //   isAlive(_ipAddress, _port)
  //       .then((alive) => {
  //         if (alive) {
  //           log.debug(LOG_PREFIX, 'TV alive, attempting reconnect...');
  //           _lgtv.connect(_connectionOptions.url);
  //         }
  //       });
  // }


  /** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** **
   * Event Handlers
   ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** */

  /**
   * Called on error.
   *
   * @param {Error} err error
   */
  function _onError(err) {
    const msg = `Error: ${err.name}`;
    log.error(LOG_PREFIX, msg, err);
  }

  /**
   * Called when TV prompts for authorization.
   */
  function _onPrompt() {
    log.log(LOG_PREFIX, 'Please authorize on TV');
    _setState('connected', false);
    _setState('ready', false);
  }

  /**
   * Called when a connection is established.
   */
  function _onConnect() {
    log.log(LOG_PREFIX, 'Connected to TV.');

    log.debug(LOG_PREFIX, 'Checking power status...');
    _sendRequest(LG_URLS.power.state)
        .then((resp) => {
          _setupConnection();
          _setState('connected', true);
        })
        .catch((err) => {
          _setState('connected', false);
          _setState('ready', false);
        });
  }

  /**
   * Called when trying to establish a connection.
   */
  function _onConnecting() {
    _setState('connected', false);
    _setState('ready', false);
  }

  /**
   * Called when connection is closed.
   */
  function _onClose() {
    log.log(LOG_PREFIX, 'Disconnected from TV.');
    _setState('connected', false);
    _setState('ready', false);
    _pointerInputSocket = null;
  }


  /** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** **
   * Setup for first connection
   ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** */

  /**
   * Set up the initial connection
   */
  function _setupConnection() {
    _getTVInfo()
        .then(() => {
          return _addDefaultSubscriptions();
        }).then(() => {
          return _connectToPointerInputSocket();
        }).then(() => {
          return _setState('ready', true);
        });
  }

  /**
   * Get the current TV info
   *
   * @return {Promise}
   */
  function _getTVInfo() {
    log.debug(LOG_PREFIX, 'Getting TV info...');
    const promises = [];

    const systemInfo = _sendRequest(LG_URLS.get.systemInfo);
    systemInfo.then((resp) => {
      _setState('systemInfo', resp);
    }).catch((err) => {
      log.error(LOG_PREFIX, `getTVInfo: 'systemInfo' failed`, err);
    });
    promises.push(systemInfo);

    const swInfo = _sendRequest(LG_URLS.get.swInfo);
    swInfo.then((resp) => {
      _setState('swInfo', resp);
    }).catch((err) => {
      log.error(LOG_PREFIX, `getTVInfo: 'swInfo' failed`, err);
    });
    promises.push(swInfo);

    const services = _sendRequest(LG_URLS.get.servicesList);
    services.then((resp) => {
      _setState('services', resp.services);
    }).catch((err) => {
      log.error(LOG_PREFIX, `getTVInfo: 'services' failed`, err);
    });
    promises.push(services);

    const launchPoints = _sendRequest(LG_URLS.apps.launchPoints);
    launchPoints.then((resp) => {
      _setState('launchPoints', resp.launchPoints);
    }).catch((err) => {
      log.error(LOG_PREFIX, `getTVInfo: 'launchPoints' failed`, err);
    });
    promises.push(launchPoints);

    const externalInputs = _sendRequest(LG_URLS.get.externalInputList);
    externalInputs.then((resp) => {
      _setState('inputs', resp.devices);
    }).catch((err) => {
      log.error(LOG_PREFIX, `getTVInfo: 'externalInputs' failed`, err);
    });
    promises.push(externalInputs);

    return Promise.all(promises);
  }

  /**
   * Adds the default event listeners
   */
  function _addDefaultSubscriptions() {
    log.debug(LOG_PREFIX, 'Adding default subscriptions...');

    _lgtv.subscribe(`ssap://${LG_URLS.power.state}`, (err, resp) => {
      if (!resp || err || resp.errorCode) {
        const obj = {err, resp};
        log.error(LOG_PREFIX, 'Subscription TV Power Status failed', obj);
        return;
      }
      log.verbose(LOG_PREFIX, `-SUB- powerState`, resp);
      _setState('powerState', resp);
    });

    _lgtv.subscribe(`ssap://${LG_URLS.apps.foregroundAppInfo}`, (err, resp) => {
      if (!resp || err || resp.errorCode) {
        const obj = {err, resp};
        log.error(LOG_PREFIX, 'Subscription foregroundAppInfo failed', obj);
        return;
      }
      log.verbose(LOG_PREFIX, `-SUB- foregroundAppInfo`, resp);
      _setState('currentAppId', resp.appId);
    });

    _lgtv.subscribe(`ssap://${LG_URLS.volume.status}`, (err, resp) => {
      if (!resp || err || resp.errorCode) {
        const obj = {err, resp};
        log.error(LOG_PREFIX, 'Subscription volumeStatus failed', obj);
        return;
      }
      log.verbose(LOG_PREFIX, `-SUB- volStatus`, resp);
      _setState('volume', resp.volume);
      _setState('muted', resp.mute);
    });

    _lgtv.subscribe(`ssap://${LG_URLS.volume.soundOutput}`, (err, resp) => {
      if (!resp || err || resp.errorCode) {
        const obj = {err, resp};
        log.error(LOG_PREFIX, 'Subscription soundOutput failed', obj);
        return;
      }
      log.verbose(LOG_PREFIX, `-SUB- soundOutput`, resp);
      _setState('soundOutput', resp.soundOutput);
    });

    _lgtv.subscribe(`ssap://${LG_URLS.get.currentChannel}`, (err, resp) => {
      if (!resp || err || resp.errorCode) {
        const obj = {err, resp};
        log.error(LOG_PREFIX, 'Subscription currentChannel failed', obj);
        return;
      }
      log.verbose(LOG_PREFIX, `-SUB- channelNumber`, resp);
      _setState('currentChannel', resp.channelNumber);
    });
  }

  /**
   * Sets up the button socket
   *
   * @return {Promise}
   */
  function _connectToPointerInputSocket() {
    const msg = `Pointer Input Socket:`;
    log.verbose(LOG_PREFIX, `${msg} init.`);
    return new Promise((resolve, reject) => {
      _lgtv.getSocket(`ssap://${LG_URLS.pointer.getSocket}`, (err, sock) => {
        if (err) {
          log.exception(LOG_PREFIX, `${msg} error.`, err);
          reject(err);
          return;
        }
        _pointerInputSocket = sock;
        log.verbose(LOG_PREFIX, `${msg} ready.`);
        resolve(true);
      });
    });
  }


  /** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** **
   * API helper functions
   ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** */

  /**
   * Helper function, fired when device status changed.
   *
   * @param {String} apiName
   * @param {Object} value
   */
  function _setState(apiName, value) {
    const msg = `setState: '${apiName}'`;
    if (value === null || value === undefined) {
      log.error(LOG_PREFIX, `${msg} - failed, empty state`);
      return;
    }
    if (value.hasOwnProperty('returnValue')) {
      delete value['returnValue'];
    }
    if (_self.state[apiName] === value) {
      return;
    }
    log.verbose(LOG_PREFIX, msg, value);
    _self.state[apiName] = value;
    _self.emit(apiName, value);
  }

  /**
   * Show the connection key
   *
   * @param {*} key
   * @param {Function} callback
   */
  function _saveKey(key, callback) {
    log.debug(LOG_PREFIX, 'saveKey()', key);
    if (callback) {
      callback();
    }
  }


  /** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** **
   * Command handlers
   ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** */

  /**
   * Shows a toast
   *
   * @param {String} message
   * @return {Promise}
   */
  function _showToast(message) {
    if (!message) {
      return Promise.reject(new Error('No message provided.'));
    }
    return _sendRequest(LG_URLS.createToast, {message});
  }

  /**
   * Launch a specific app
   *
   * @param {String} id App ID to launch
   * @return {Promise}
   */
  function _launchApp(id) {
    if (!id) {
      return Promise.reject(new Error('No app ID provided.'));
    }
    return _sendRequest(LG_URLS.apps.launch, {id});
  }

  /**
   * Closes the currently open app.
   *
   * @return {Promise}
   */
  function _closeApp() {
    return _sendRequest(LG_URLS.apps.close);
  }

  /**
   * Set the TV to a specific input
   * @param {String} inputId
   * @return {Promise}
   */
  function _setInput(inputId) {
    if (!inputId) {
      return Promise.reject(new Error('No inputId provided'));
    }
    return _sendRequest(LG_URLS.switchInput, {inputId});
  }

  /**
   * Set the volume to a specific level.
   *
   * @param {Number} volume
   * @return {Promise}
   */
  function _setVolume(volume) {
    volume = parseInt(volume);
    if (_isValidInt(volume, 0, 100)) {
      return _sendRequest(LG_URLS.volume.set, {volume});
    }
    return Promise.reject(new Error('Invalid volume level provided'));
  }

  /**
   * Sets the mute state
   *
   * @param {Boolean} muted
   * @return {Promise}
   */
  function _setMute(muted) {
    const mute = muted == true ? true : false;
    return _sendRequest(LG_URLS.volume.mute, {mute});
  }

  /**
   * Send a media command to the TV.
   *
   * @param {String} cmd
   * @return {Promise}
   */
  function _sendMediaCommand(cmd) {
    const validCommands = Object.keys(LG_URLS.mediaControls);
    if (!cmd || !validCommands.includes(cmd.toLowerString())) {
      return Promise.reject(new Error(`Invalid media command: '${cmd}'`));
    }
    const url = LG_URLS.mediaControls[cmd];
    return _sendRequest(url);
  }


  /** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** **
   * Send commands to TV
   ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** */

  /**
   * Sends a button command
   *
   * @param {String} button
   * @return {Promise}
   */
  function _sendButton(button) {
    if (!LG_BUTTONS.includes(button)) {
      return Promise.reject(new Error(`Invalid button '${button}'`));
    }
    if (!_pointerInputSocket) {
      return Promise.reject(new Error(`No input socket available`));
    }
    log.verbose(LOG_PREFIX, `sendButton('${button}')`);
    const opts = {name: button};
    _pointerInputSocket.send('button', opts);
    return Promise.resolve(opts);
  }

  /**
   * Moves the mouse
   *
   * @param {Object} details
   * @param {Number} details.dx
   * @param {Number} details.dy
   * @param {Number} [details.drag] Must be '1' or not present.
   * @return {Promise}
   */
  function _moveMouse(details) {
    if (!details) {
      return Promise.reject(new Error(`Cannot move mouse, no args`));
    }
    if (!details.hasOwnProperty('dx') || !details.hasOwnProperty('dy')) {
      const msg = `Invalid arguments, requires dx, dy`;
      log.error(LOG_PREFIX, msg, details);
      return Promise.reject(new Error(`Invalid arguments, requires dx, dy`));
    }
    const cmd = details.drag === 1 ? 'drag' : 'move';
    log.verbose(LOG_PREFIX, `moveMouse('${cmd}', opts)`, details);
    _pointerInputSocket.send(cmd, details);
    return Promise.resolve(details);
  }

  /**
   * Sends a request to the TV
   *
   * @param {String} url
   * @param {Object} [payload]
   * @return {Promise}
   */
  function _sendRequest(url, payload) {
    if (!url.startsWith('ssap://')) {
      url = 'ssap://' + url;
    }
    const msg = `sendRequest('${url}', payload)`;
    log.verbose(LOG_PREFIX, msg, payload);
    return new Promise((resolve, reject) => {
      _lgtv.request(url, payload, (err, resp) => {
        if (err) {
          reject(err);
          return;
        }
        if (resp.errorCode) {
          reject(resp);
          return;
        }
        resolve(resp);
      });
    });
  }


  /** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** **
   * Utility functions
   ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** */

  /**
   * Checks if the input is a valid integer between min and max.
   *
   * @param {*} val
   * @param {Number} min
   * @param {Number} max
   * @return {Boolean}
   */
  function _isValidInt(val, min, max) {
    val = parseInt(val);
    if (!Number.isInteger(val)) {
      return false;
    }
    if (val > max) {
      return false;
    }
    if (val < min) {
      return false;
    }
    return true;
  }
}

util.inherits(LGTV, EventEmitter);

module.exports = LGTV;
