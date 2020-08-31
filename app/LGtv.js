'use strict';

const util = require('util');
const log = require('./SystemLog2');
const EventEmitter = require('events').EventEmitter;

const LOG_PREFIX = 'LG_TV';

const LG_URLS = {
  get: {
    foregroundAppInfo: 'ssap://com.webos.applicationManager/getForegroundAppInfo',
    powerState: 'ssap://com.webos.service.tvpower/power/getPowerState',
    servicesList: 'ssap://api/getServiceList',
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
 * @param {Object} credentials login credentials.
*/
function LGTV(credentials) {
  let _ready = false;
  let _lgtv;
  const _self = this;

  /**
   * Init
   */
  function _init() {
    log.init(LOG_PREFIX, 'Starting...');
    if (!credentials) {
      log.error(LOG_PREFIX, 'Not credentials provided, aborting...');
      return;
    }
    const initOpts = {
      url: 'ws://lgwebostv:3000',
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
    if (_ready !== true) {
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
      const opts = {};
      return _sendRequest(LG_URLS.switchInput, opts);
    }
  };

  /**
   * Saves the Key
   * @param {*} a
   * @param {*} b
   * @param {*} c
   */
  function _saveKey(a, b, c) {
    console.log('saveKey', a, b, c);
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
    _sendRequest(LG_URLS.get.servicesList)
        .then((services) => {
          log.verbose(LOG_PREFIX, 'Services', services);
          _self.emit('services', services);
        });
    _lgtv.subscribe(LG_URLS.get.foregroundAppInfo, (err, res) => {
      _emitChange('foreground_app', err, res);
    });
    _lgtv.subscribe(LG_URLS.get.powerState, (err, res) => {
      _emitChange('power_state', err, res);
    });
    _ready = true;
  }

  /**
   * Helper function, fired when device status changed.
   * @param {String} apiName
   * @param {Error} err
   * @param {Object} value
   */
  function _emitChange(apiName, err, value) {
    if (err) {
      log.exception(LOG_PREFIX, `Error in '${apiName}' change`, err);
      return;
    }
    log.verbose(LOG_PREFIX, `Changed: '${apiName}'`, value);
    _self.emit(apiName, value);
  }

  /**
   * Called when trying to establish a connection.
   */
  function _onConnecting() {
    log.debug(LOG_PREFIX, 'Connecting...');
  }

  /**
   * Called when connection is closed.
   */
  function _onClose() {
    log.warn(LOG_PREFIX, 'Connection closed');
    _ready = false;
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

  _init();
}

util.inherits(LGTV, EventEmitter);

module.exports = LGTV;
