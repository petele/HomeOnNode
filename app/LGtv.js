'use strict';

const util = require('util');
const log = require('./SystemLog2');
const EventEmitter = require('events').EventEmitter;

const LOG_PREFIX = 'LG_TV';

const LG_URLS = {
  get: {
    appStatus: 'ssap://com.webos.service.appstatus/getAppStatus',
    foregroundAppInfo: 'ssap://com.webos.applicationManager/getForegroundAppInfo',
    powerState: 'ssap://com.webos.service.tvpower/power/getPowerState',
    servicesList: 'ssap://api/getServiceList',
    systemInfo: 'ssap://system/getSystemInfo',
    volume: 'ssap://audio/getVolume',
  },
  createToast: 'ssap://system.notifications/createToast',
  launch: 'ssap://system.launcher/launch',
  powerOff: 'ssap://system/turnOff',
  powerOn: 'ssap://system/turnOn',
  switchInput: 'tv/switchInput',
};

/**
 * LG TV API.
 * @constructor
 *
 * @see https://github.com/hobbyquaker/lgtv2
 *
 * @param {String} ipAddress IP Address of TV.
 * @param {Object} credentials login credentials.
*/
function LGTV(ipAddress, credentials) {
  let _lgtv;
  const _lgtvURL = `ws://${ipAddress}:3000`;
  const _self = this;
  // connectionState - 0 not connected, 1 connecting, 2 connected.
  this.state = {
    connectionState: 0,
  };

  /**
   * Init
   */
  function _init() {
    log.init(LOG_PREFIX, 'Starting...');
    if (!ipAddress) {
      log.error(LOG_PREFIX, 'No IP Address provided, aborting...');
      return;
    }
    if (!credentials) {
      log.error(LOG_PREFIX, 'No credentials provided, aborting...');
      return;
    }
    const initOpts = {
      url: _lgtvURL,
      saveKey: _saveKey,
      clientKey: credentials,
    };
    _lgtv = require('lgtv2')(initOpts);
    _lgtv.on('error', _onError);
    _lgtv.on('prompt', _onPrompt);
    _lgtv.on('connect', _onConnect);
    _lgtv.on('connecting', _onConnecting);
    _lgtv.on('close', _onClose);
  }

  /*
    ssap://system/getSystemInfo
   */

  /**
   * Execute a NanoLeaf command.
   *
   * @param {Object} command The command to run.
   * @return {Promise} The promise that will be resolved on completion.
  */
  this.executeCommand = function(command) {
    if (_self.state.connectionState !== 2) {
      return Promise.reject(new Error('Not Ready'));
    }
    if (command.hasOwnProperty('powerOff')) {
      return _sendRequest(LG_URLS.powerOff);
    }
    if (command.hasOwnProperty('powerOn')) {
      return _sendRequest(LG_URLS.powerOn);
    }
    if (command.hasOwnProperty('showToast')) {
      const opts = {message: command.showToast};
      return _sendRequest(LG_URLS.createToast, opts);
    }
    if (command.hasOwnProperty('launch')) {
      const opts = {id: command.launch};
      return _sendRequest(LG_URLS.launch, opts);
    }
    if (command.hasOwnProperty('setInput')) {
      const opts = {inputId: command.setInput};
      return _sendRequest(LG_URLS.switchInput, opts);
    }
  };

  /**
   *
   * @param {*} key
   * @param {Function} callback
   */
  function _saveKey(key, callback) {
    log.log(LOG_PREFIX, 'saveKey()', key);
    if (callback) {
      callback();
    }
  }

  /**
   * Called on error.
   *
   * @param {Error} err error
   */
  function _onError(err) {
    const msg = `Generic Error`;
    log.exception(LOG_PREFIX, msg, err);
  }

  /**
   * Called when TV prompts for authorization.
   */
  function _onPrompt() {
    log.log(LOG_PREFIX, 'Please authorize on TV');
  }

  /**
   * Called when a connection is established.
   */
  function _onConnect() {
    log.log(LOG_PREFIX, 'Connected');
    const promises = [];

    // Power State
    const p = _sendRequest(LG_URLS.get.powerState)
        .then((powerState) => {
          _setState('powerState', null, powerState);
        })
        .catch((err) => {
          _setState('powerState', err);
        })
        .then(() => {
          _subscribe('powerState', LG_URLS.get.powerState);
        });
    promises.push(p);

    // Foreground App
    const fai = _sendRequest(LG_URLS.get.foregroundAppInfo)
        .then((data) => {
          _setState('foregroundApp', null, data);
        })
        .catch((err) => {
          _setState('foregroundApp', err);
        })
        .then(() => {
          _subscribe('foregroundApp', LG_URLS.get.foregroundAppInfo);
        });
    promises.push(fai);

    // System Info
    const si = _sendRequest(LG_URLS.get.systemInfo)
        .then((data) => {
          _setState('systemInfo', null, data);
        })
        .catch((err) => {
          _setState('systemInfo', err);
        })
        .then(() => {
          _subscribe('systemInfo', LG_URLS.get.systemInfo);
        });
    promises.push(si);

    // Volume
    const vol = _sendRequest(LG_URLS.get.volume)
        .then((data) => {
          _setState('volume', null, data);
        })
        .catch((err) => {
          _setState('volume', err);
        })
        .then(() => {
          _subscribe('volume', LG_URLS.get.volume);
        });
    promises.push(vol);

    // App Status
    const as = _sendRequest(LG_URLS.get.appStatus)
        .then((data) => {
          _setState('appStatus', null, data);
        })
        .catch((err) => {
          _setState('appStatus', err);
        })
        .then(() => {
          _subscribe('appStatus', LG_URLS.get.appStatus);
        });
    promises.push(as);

    Promise.all(promises).then(() => {
      _setState('connectionState', null, 2);
    });
  }

  /**
   * Helper function, fired when device status changed.
   * @param {String} apiName
   * @param {Error} err
   * @param {Object} value
   */
  function _setState(apiName, err, value) {
    if (err) {
      log.exception(LOG_PREFIX, `Error in '${apiName}' change`, err);
      return;
    }
    log.verbose(LOG_PREFIX, `Changed: '${apiName}'`, value);
    _self.state[apiName] = value;
    _self.emit(apiName, value);
  }

  /**
   * Called when trying to establish a connection.
   */
  function _onConnecting() {
    log.debug(LOG_PREFIX, 'Connecting...');
    _setState('connectionState', null, 1);
  }

  /**
   * Called when connection is closed.
   */
  function _onClose() {
    log.warn(LOG_PREFIX, 'Connection closed.');
    _setState('connectionState', null, 0);
  }

  /**
   *
   * @param {String} url
   * @param {Object} [payload]
   * @return {Promise}
   */
  function _sendRequest(url, payload) {
    const msg = `sendRequest('${url}', payload)`;
    log.verbose(LOG_PREFIX, msg, payload);
    return new Promise((resolve, reject) => {
      _lgtv.request(url, payload, (err, result) => {
        if (err) {
          reject(err);
          return;
        }
        resolve(result);
      });
    });
  }

  /**
   *
   * @param {String} apiName
   * @param {String} url
   */
  function _subscribe(apiName, url) {
    const msg = `subscribe('${apiName}', '${url}')`;
    log.verbose(LOG_PREFIX, msg);
    _lgtv.subscribe(url, (err, res) => {
      _setState(apiName, err, res);
    });
  }

  _init();
}

util.inherits(LGTV, EventEmitter);

module.exports = LGTV;
