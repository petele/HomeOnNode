'use strict';

const EventEmitter = require('events').EventEmitter;
const util = require('util');

const Hue = require('./Hue');
const LGTV = require('./LGtv');
const Wemo = require('./Wemo');
const Tivo = require('./Tivo');
const Sonos = require('./Sonos');
const Awair = require('./Awair');
const moment = require('moment');

const log = require('./SystemLog2');
const AppleTV = require('./AppleTV');
const Logging = require('./Logging');
const honExec = require('./HoNExec');
const GCMPush = require('./GCMPush');
const fsProm = require('fs/promises');
const Harmony = require('./HarmonyWS');
const Weather = require('./Weather');
const NanoLeaf = require('./NanoLeaf');
const Presence = require('./Presence');
const CronJob = require('cron').CronJob;
const Bluetooth = require('./Bluetooth');
const PushBullet = require('./PushBullet');
const AlarmClock = require('./AlarmClock');
const deepDiff = require('deep-diff').diff;

const FBHelper = require('./FBHelper');
// const ConfigHelper = require('./ConfigHelper');

const LOG_PREFIX = 'HOME';

/**
 * Home API
 * @constructor
 */
function Home() {
  const _self = this;
  _self.state = {};

  let _config;
  let _fbRootRef;

  let alarmClock;
  let appleTV;
  let awair;
  let bluetooth;
  let gcmPush;
  let harmony;
  let hue;
  let lgTV;
  let logging;
  let nanoLeaf;
  let presence;
  let pushBullet;
  let sonos;
  let tivo;
  let weather;
  let wemo;

  let _doorOpenAccounceTimer;
  let _armingTimer;
  let _lastSoundPlayedAt = 0;

  const _delayedCmdTimers = {};
  let _delayedCmdCounter = 0;


  /** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** **
   *
   * Init
   *
   ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** **/

  /**
   * Initialize the HOME API
   */
  async function _init() {
    log.init(LOG_PREFIX, 'Starting...');

    try {
      log.log(LOG_PREFIX, 'Reading config from Firebase...');
      _fbRootRef = await FBHelper.getRootRef(30 * 1000);
      const fbConfigRef = await _fbRootRef.child(`config/HomeOnNode`);
      _config = await fbConfigRef.once('value');
      _config = _config.val();
    } catch (ex) {
      log.error(LOG_PREFIX, `Unable to get config from Firebase...`, ex);
    }

    if (!_config || _config._configType !== 'HoN') {
      log.log(LOG_PREFIX, `Reading config from 'config.json'...`);
      try {
        const configFile = 'config.json';
        const configStr = await fsProm.readFile(configFile, {encoding: 'utf8'});
        _config = JSON.parse(configStr);
      } catch (ex) {
        const msg = `Unable to read config file from disk.`;
        log.exception(LOG_PREFIX, msg, ex);
        throw new Error(msg);
      }
    }

    const now = Date.now();
    _self.state = {
      delayedCommands: {},
      doNotDisturb: false,
      hasNotification: false,
      presence: {
        people: {},
        state: 'NONE',
      },
      systemState: 'AWAY',
      time: {
        started: now,
        started_: log.formatTime(now),
        lastUpdated: now,
        lastUpdated_: log.formatTime(now),
      },
    };

    if (_fbRootRef) {
      const fbState = await _fbRootRef.child('state');
      const fbPrevStateSnap = await fbState.once('value');
      const fbPrevState = await fbPrevStateSnap.val();
      log.log(LOG_PREFIX, 'Updating state based on previous state.');
      _self.state.doNotDisturb = fbPrevState.doNotDisturb;
      _self.state.hasNotification = fbPrevState.hasNotification;
      _self.state.systemState = fbPrevState.systemState;
    } else {
      _waitForFBRef();
    }

    gcmPush = await new GCMPush();


    await _initAlarmClock();
    await _initHue();
    await _initNanoLeaf();
    await _initSonos();
    await _initHarmony();

    return;
    // _initAppleTV();
    // _initBluetooth();
    // _initNotifications();



    // _initTivo();
    // _initPushBullet();
    // _initWeather();
    // _initWemo();
    // _initLGTV();
    // _initAwair();
    // _initPresence();
    // _initCron();
    // _initAutoHumidifier();
    setTimeout(function() {
      _self.emit('ready');
      _playSound(_config.readySound);
    }, 750);

    _initConfigWatcher();
  }


  /**
   *
   */
  async function _initConfigWatcher() {
    try {
      const fbRootRef = await FBHelper.getRootRefUnlimited();
      const fbConfigRef = await fbRootRef.child(`config/HomeOnNode`);
      fbConfigRef.on('value', (newVal) => {
        const newConfig = newVal.val();
        if (deepDiff(_config, newConfig)) {
          _config = newConfig;
          log.log(LOG_PREFIX, 'Config updated.');
          try {
            fsProm.writeFile('config.json', JSON.stringify(_config));
            log.verbose(LOG_PREFIX, `Wrote config to 'config.json'.`);
          } catch (ex) {
            log.exception(LOG_PREFIX, 'Unable to write config to disk.', ex);
          }
        }
      });
    } catch (ex) {
      log.exception(LOG_PREFIX, 'Error while setting up config watcher', ex);
    }
  }

  /**
   *
   */
  async function _waitForFBRef() {
    try {
      _fbRootRef = await FBHelper.getRootRefUnlimited();
      const state = await _fbRootRef.child('state');
      state.set(_self.state);
    } catch (ex) {
      log.exception(LOG_PREFIX, 'Unable to get state object.', ex);
    }
  }

  /** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** **
   *
   * Public APIs
   *
   ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** **/

  /**
   * Executes the specified named command.
   *
   * @param {String} commandName The name of the command to execute.
   * @param {String} source The source of the command.
   * @return {Object} result of command or undefined if it failed.
   */
  this.executeCommandByName = function(commandName, source) {
    if (!commandName) {
      log.warn(LOG_PREFIX, 'commandName not provided.');
      return;
    }

    // Find the command
    const command = _config.commands[commandName];
    if (!command) {
      log.warn(LOG_PREFIX, `Command ${commandName} not found.`);
      return;
    }

    // Logging
    const msg = `executeCommandByName('${commandName}', '${source}')`;
    if (source.endsWith('+')) {
      log.verbose(LOG_PREFIX, msg, command);
    } else {
      log.log(LOG_PREFIX, msg, command);
    }

    // Execute any actions in the command
    if (command.actions) {
      return _self.executeActions(command.actions, commandName);
    }
    log.warn(LOG_PREFIX, `Command '${commandName}' has no actions.`, command);
  };

  /**
   * Executes a collection of actions.
   *
   * @param {Array} actions The collection of actions to execute.
   * @param {String} source The source of the command.
   * @return {Array} result of the actions or undefined if it failed.
   */
  this.executeActions = function(actions, source) {
    const results = [];
    // Loop through the actions in the list
    _arrayify(actions).forEach((actionSrc) => {
      if (!actionSrc) {
        return;
      }

      // Make an editable copy of the action.
      const action = Object.assign({}, actionSrc);

      // Run the action on a delay.
      if (action.delay) {
        _runDelayedCommand(action, source);
        return;
      }

      // Check if the required conditions are met
      if (action.conditions) {
        if (!_checkConditions(action.conditions)) {
          return;
        }
        delete action.conditions;
      }

      // If it's a cmdName, load the command and run that.
      if (action.cmdName) {
        results.push(_self.executeCommandByName(action.cmdName, `${source}+`));
        return;
      }

      // Execute the action.
      results.push(_executeAction(action, source));
    });
    return Promise.all(results)
        .then((r) => {
          log.verbose(LOG_PREFIX, 'executeActions(...) complete.', r);
          return r;
        });
  };

  /**
   * Wrapper to catch old function calls.
   * @param {Object} command The command to execute.
   * @param {String} source The source of the command.
   * @return {bool} Always returns false.
   */
  this.executeCommand = function(command, source) {
    const msg = `executeCommand not longer supported! Called by: '${source}'.`;
    log.error(LOG_PREFIX, msg, command);
    return false;
  };

  /**
   * Shutdown the HOME Service
   */
  this.shutdown = function() {
    log.log(LOG_PREFIX, 'Shutting down...');
    _shutdownBluetooth();
    _shutdownHarmony();
    _shutdownPushBullet();
    _shutdownTivo();
    _shutdownLGTV();
  };

  /** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** **
   *
   * Execute Action - handles the actual execution of an action.
   *
   ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** **/

  /**
   * Executes a single of action.
   *
   * @param {Object} action The action to execute.
   * @param {String} source The source of the command.
   * @return {Object} result of the action or undefined if it failed.
   */
  function _executeAction(action, source) {
    if (!action || typeof action !== 'object') {
      log.error(LOG_PREFIX, `executeAction failed, invalid action.`, action);
      return _genResult(action, false, 'invalid_param');
    }

    // Logging
    const k = Object.keys(action);
    if (k.length === 1) {
      log.log(LOG_PREFIX, `executeAction('${k[0]}', '${source}')`, action);
    } else {
      const keys = k.join(', ');
      log.error(LOG_PREFIX, `executeAction([${keys}], '${source}')`, action);
      return _genResult(action, false, 'num_param_exceeded');
    }

    // No operation
    if (action.hasOwnProperty('noop')) {
      return _genResult(action, true, 'noop');
    }

    // Cancel a delayed timer
    if (action.hasOwnProperty('cancelDelayedCommand')) {
      const id = action.cancelDelayedCommand.id;
      if (id) {
        _cancelDelayedCommand(action.cancelDelayedCommand.id);
        return _genResult(action, true, 'cancelDelayedCommand');
      }
      return _genResult(action, false, 'cancelDelayedCommand');
    }

    // AppleTV
    if (action.hasOwnProperty('appleTV')) {
      if (!appleTV) {
        log.error(LOG_PREFIX, 'AppleTV unavailable.');
        return _genResult(action, false, 'not_available');
      }
      return appleTV.send(action.appleTV)
          .then((result) => {
            return _genResult(action, true, result);
          })
          .catch((err) => {
            log.verbose(LOG_PREFIX, `Whoops: AppleTV failed.`, err);
            return _genResult(action, false, err);
          });
    }

    // Awair
    if (action.hasOwnProperty('awair')) {
      if (!awair) {
        log.error(LOG_PREFIX, 'Awair unavailable.');
        return _genResult(action, false, 'not_available');
      }
      const deviceName = action.awair.deviceName;
      const deviceKey = awair.getDeviceKeyByName(deviceName);
      if (!deviceKey) {
        log.error(LOG_PREFIX, `AWAIR: Could not find ${deviceName}`);
        return _genResult(action, false, 'device_not_found');
      }
      const deviceType = deviceKey.deviceType;
      const deviceId = deviceKey.deviceId;
      return awair.updateSettings(deviceType, deviceId, action.awair)
          .then((result) => {
            return _genResult(action, true, result);
          })
          .catch((err) => {
            log.verbose(LOG_PREFIX, `Whoops: Awair failed.`, err);
            return _genResult(action, false, err);
          });
    }

    // Do not disturb
    if (action.hasOwnProperty('doNotDisturb')) {
      return _setDoNotDisturb(action.doNotDisturb)
          .then((result) => {
            return _genResult(action, true, result);
          })
          .catch((err) => {
            return _genResult(action, false, err);
          });
    }

    // Door open/closed
    if (action.hasOwnProperty('door')) {
      return _handleDoorEvent(action.door.name, action.door.state)
          .then((result) => {
            return _genResult(action, true, result);
          })
          .catch((err) => {
            return _genResult(action, false, err);
          });
    }

    // Doorbell
    if (action.hasOwnProperty('doorbell')) {
      return _ringDoorbell(source)
          .then((result) => {
            return _genResult(action, true, result);
          })
          .catch((err) => {
            return _genResult(action, false, err);
          });
    }

    // Execute command
    if (action.hasOwnProperty('exec')) {
      const title = action.exec.title;
      const execCmd = action.exec.cmd;
      const execCWD = action.exec.cwd;
      return honExec.run(title, execCmd, execCWD)
          .then((result) => {
            return _genResult(action, true, result);
          })
          .catch((err) => {
            return _genResult(action, false, err);
          });
    }

    // Harmony activity
    if (action.hasOwnProperty('harmonyActivity')) {
      if (!harmony) {
        log.error(LOG_PREFIX, 'Harmony unavailable.', action);
        return _genResult(action, false, 'not_available');
      }

      return harmony.setActivityByName(action.harmonyActivity)
          .then((result) => {
            return _genResult(action, true, result);
          })
          .catch((err) => {
            return _genResult(action, false, err);
          });
    }

    // Harmony key
    if (action.hasOwnProperty('harmonyKey')) {
      if (!harmony) {
        log.error(LOG_PREFIX, 'Harmony unavailable.', action);
        return _genResult(action, false, 'not_available');
      }

      return harmony.sendKey(action.harmonyKey)
          .then((result) => {
            return _genResult(action, true, result);
          })
          .catch((err) => {
            return _genResult(action, false, err);
          });
    }

    // Hue command
    if (action.hasOwnProperty('hueCommand')) {
      if (!hue || !hue.isReady()) {
        log.error(LOG_PREFIX, 'Hue unavailable.', action);
        return _genResult(action, false, 'not_available');
      }

      // Get the receipe/light state
      let receipe;
      if (action.hueCommand.lightState) {
        receipe = action.hueCommand.lightState;
      } else if (action.hueCommand.receipeName) {
        receipe = _getLightReceipeByName(action.hueCommand.receipeName);
      }
      if (!receipe) {
        log.error(LOG_PREFIX, `Unable to retreive receipe.`, action.hueCommand);
        return _genResult(action, false, 'receipe_not_found');
      }

      // Set the lights
      return hue.setLights(action.hueCommand.lights, receipe)
          .then((result) => {
            return _genResult(action, true, result);
          })
          .catch((err) => {
            log.verbose(LOG_PREFIX, `Whoops: hueCommand failed.`, err);
            return _genResult(action, false, err);
          });
    }

    // Hue request
    if (action.hasOwnProperty('hueRequest')) {
      if (!hue || !hue.isReady()) {
        log.error(LOG_PREFIX, 'Hue unavailable.', action);
        return _genResult(action, false, 'not_available');
      }

      const path = action.hueRequest.path;
      const method = action.hueRequest.method;
      const body = action.hueRequest.body;
      return hue.sendRequest(path, method, body)
          .then((result) => {
            return _genResult(action, true, result);
          })
          .catch((err) => {
            log.verbose(LOG_PREFIX, `Whoops: hueRequest failed.`, err);
            return _genResult(action, false, err);
          });
    }

    // Hue scene
    if (action.hasOwnProperty('hueScene')) {
      if (!hue || !hue.isReady()) {
        log.error(LOG_PREFIX, 'Hue unavailable.', action);
        return _genResult(action, false, 'not_available');
      }

      return hue.setScene(action.hueScene)
          .then((result) => {
            return _genResult(action, true, result);
          })
          .catch((err) => {
            log.verbose(LOG_PREFIX, `Whoops: hueScene failed.`, err);
            return _genResult(action, false, err);
          });
    }

    // Hue Motion Sensor Scene
    if (action.hasOwnProperty('hueSceneForRules')) {
      if (!hue || !hue.isReady()) {
        log.error(LOG_PREFIX, 'Hue unavailable.', action);
        return _genResult(action, false, 'not_available');
      }

      const rules = action.hueSceneForRules.rules;
      const sceneId = action.hueSceneForRules.sceneId;
      if (!rules || !sceneId) {
        log.error(LOG_PREFIX, 'hueSceneForRules, invalid params.', action);
        return _genResult(action, false, 'invalid_params');
      }

      return hue.setSceneForRules(rules, sceneId)
          .then((result) => {
            return _genResult(action, true, result);
          })
          .catch((err) => {
            log.verbose(LOG_PREFIX, `Whoops: hueSceneForRules failed.`, err);
            return _genResult(action, false, err);
          });
    }

    // LG TV
    if (action.hasOwnProperty('lgTV')) {
      if (!lgTV) {
        log.error(LOG_PREFIX, 'LG TV unavailable.', action);
        return _genResult(action, false, 'not_available');
      }

      return lgTV.executeCommand(action.lgTV)
          .then((result) => {
            return _genResult(action, true, result);
          })
          .catch((err) => {
            log.verbose(LOG_PREFIX, `Whoops: LGTV failed.`, err);
            return _genResult(action, false, err);
          });
    }

    // Log
    if (action.hasOwnProperty('log')) {
      const level = action.log.level || 'LOG';
      const sender = action.log.sender || source;
      const message = action.log.message;
      const extra = action.log.extra;
      if (level === 'LOG') {
        return log.log(sender, message, extra);
      }
      if (level === 'ERROR') {
        return log.error(sender, message, extra);
      }
      if (level === 'EXCEPTION') {
        return log.exception(sender, message, extra);
      }
      return log.debug(sender, message, extra);
    }

    // NanoLeaf
    if (action.hasOwnProperty('nanoLeaf')) {
      if (!nanoLeaf) {
        log.error(LOG_PREFIX, 'nanoLeaf unavailable.');
        return _genResult(action, false, 'not_available');
      }

      if (action.nanoLeaf.effect === '-DEFAULT-') {
        const defaultEffect = _config.nanoLeaf.defaultEffect;
        action.nanoLeaf.effect = defaultEffect;
      }

      return nanoLeaf.executeCommand(action.nanoLeaf)
          .then((result) => {
            return _genResult(action, true, result);
          })
          .catch((err) => {
            log.verbose(LOG_PREFIX, `Whoops: nanoLeaf failed.`, err);
            return _genResult(action, false, err);
          });
    }

    // Say This
    if (action.hasOwnProperty('sayThis')) {
      const utterance = action.sayThis.utterance;
      const opts = action.sayThis.opts || {};
      return _sayThis(utterance, opts)
          .then((result) => {
            return _genResult(action, true, result);
          })
          .catch((err) => {
            log.verbose(LOG_PREFIX, `Whoops: sayThis failed.`, err);
            return _genResult(action, false, err);
          });
    }

    // Send Notifications
    if (action.hasOwnProperty('sendNotification')) {
      if (!gcmPush) {
        log.warn(LOG_PREFIX, 'gcmPush unavailable.');
        return _genResult(action, false, 'not_available');
      }
      return gcmPush.sendMessage(action.sendNotification)
          .then((result) => {
            return _genResult(action, true, result);
          })
          .catch((err) => {
            log.verbose(LOG_PREFIX, `Whoops: sendNotification failed.`, err);
            return _genResult(action, false, err);
          });
    }

    // Sonos
    if (action.hasOwnProperty('sonos')) {
      if (!sonos) {
        log.warn(LOG_PREFIX, 'Sonos unavailable.');
        return _genResult(action, false, 'not_available');
      }
      return sonos.executeCommand(action.sonos, _config.sonosPresetOptions)
          .then((result) => {
            return _genResult(action, true, result);
          })
          .catch((err) => {
            log.verbose(LOG_PREFIX, `Whoops: sonos failed.`, err);
            return _genResult(action, false, err);
          });
    }

    // Sound
    if (action.hasOwnProperty('sound')) {
      const soundFile = action.sound.soundFile;
      const opts = action.sound.opts || {};
      return _playSound(soundFile, opts)
          .then((result) => {
            return _genResult(action, true, result);
          })
          .catch((err) => {
            // Don't log - we probably don't care
            return _genResult(action, false, err);
          });
    }

    // State
    if (action.hasOwnProperty('state')) {
      return _setState(action.state)
          .then((result) => {
            return _genResult(action, true, result);
          })
          .catch((err) => {
            log.verbose(LOG_PREFIX, `Whoops: state failed.`, err);
            return _genResult(action, false, err);
          });
    }

    // Tivo
    if (action.hasOwnProperty('tivo')) {
      if (!tivo) {
        log.warn(LOG_PREFIX, 'TiVo unavailable.');
        return _genResult(action, false, 'not_available');
      }
      return tivo.send(action.tivo)
          .then((result) => {
            return _genResult(action, true, result);
          })
          .catch((err) => {
            log.verbose(LOG_PREFIX, `Whoops: TiVo failed.`, err);
            return _genResult(action, false, err);
          });
    }

    // Wemo
    if (action.hasOwnProperty('wemo')) {
      if (!wemo) {
        log.warn(LOG_PREFIX, 'Wemo unavailable.');
        return _genResult(action, false, 'not_available');
      }
      let id = action.wemo.id;
      if (!id && action.wemo.name) {
        id = _config.wemo.lookup[action.wemo.name.toUpperCase()];
      }
      if (!id) {
        log.warn(LOG_PREFIX, `Wemo device not found`, action.wemo);
        return _genResult(action, false, 'not_found');
      }
      return wemo.setState(id, action.wemo.on)
          .then((result) => {
            return _genResult(action, true, result);
          })
          .catch((err) => {
            log.verbose(LOG_PREFIX, `Whoops: Wemo failed.`, err);
            return _genResult(action, false, err);
          });
    }

    // Unknown action received
    log.warn(LOG_PREFIX, `Unknown action received from ${source}.`, action);
    return _genResult(action, false, 'unknown_action');
  }


  /** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** **
   *
   * System State & Firebase Logging
   *
   ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** **/

  /**
   * Update System State from fbSet
   *
   * @param {String} path The path to set.
   * @param {Object} value The value to set.
   */
  function _updateLocalState(path, value) {
    let currentObj = _self.state;
    const keys = path.split('/');
    const len = Math.max(1, keys.length -1);

    for (let i = 1; i < len; ++i) {
      const key = keys[i];
      currentObj[key] = currentObj[key] || {};
      currentObj = currentObj[key];
    }
    currentObj[keys[len]] = value;
  }

  // /**
  //  * Get System State value using / notation
  //  * @param {String} path Path to value
  //  * @return {*} Result of value
  //  */
  // function _getStateValue(path) {
  //   let result = _self.state;
  //   const items = path.split('/');
  //   items.forEach((item) => {
  //     if (result && result[item]) {
  //       result = result[item];
  //       return;
  //     }
  //     result = null;
  //   });
  //   return result;
  // }

  /**
   * Push value to Firebase
   *
   * @param {String} path Path to push object to.
   * @param {Object} value The value to push.
   * @return {any}
   */
  function _fbPush(path, value) {
    if (!_fbRootRef) {
      log.error(LOG_PREFIX, `fbPush failed, no fbRootRef`);
      return;
    }
    try {
      return _fbRootRef.child(path).push(value);
    } catch (ex) {
      log.exception(LOG_PREFIX, 'Unable to push data on path: ' + path, ex);
    }
    return null;
  }

  /**
   * Set value to Firebase
   *
   * @param {String} path Path to push object to
   * @param {Object} value The value to push
   * @return {any}
   */
  function _fbSet(path, value) {
    if (path.indexOf('state/') === 0) {
      _updateLocalState(path, value);
    }
    if (!_fbRootRef) {
      log.error(LOG_PREFIX, `fbSet failed, no fbRootRef`);
      return;
    }
    try {
      const result = _fbRootRef.child(path).set(value);
      fbSetLastUpdated();
      return result;
    } catch (ex) {
      log.exception(LOG_PREFIX, 'Unable to set data on path: ' + path, ex);
    }
  }

  /**
   * Set state last updated.
   */
  function fbSetLastUpdated() {
    if (!_fbRootRef) {
      return;
    }
    const now = Date.now();
    const info = {
      lastUpdated: now,
      lastUpdated_: log.formatTime(now),
    };
    _fbRootRef.child('state/time').set(info);
  }

  /** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** **
   *
   * Internal Helper Functions
   *
   ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** **/

  /**
   *
   * @param {Object} action The action that was executed.
   * @param {boolean} success If the action was successful.
   * @param {Object} data The result of the action called.
   * @return {Object} action object.
   */
  function _genResult(action, success, data) {
    const result = {
      success: success === true,
      action: action,
      result: data,
    };
    if (!action || typeof action !== 'object') {
      result.actionName = '_action_';
    } else {
      const keys = Object.keys(action);
      if (keys.length === 1) {
        result.actionName = keys[0];
      } else {
        result.actionName = '_action_';
      }
    }
    return result;
  }

  /**
   * Take an object and turns it into an array
   *
   * @param {Object} val - Object to arrayify.
   * @return {Array} arrayified object.
   */
  function _arrayify(val) {
    if (Array.isArray(val)) {
      return val;
    }
    return [val];
  }

  /**
   * Handles a door open/close event
   *
   * @param {String} doorName Name of the door, ie front
   * @param {String} doorState Door state (OPEN/CLOSED)
   * @return {Object} doorLogObj
   */
  function _handleDoorEvent(doorName, doorState) {
    if (!doorName) {
      log.error(LOG_PREFIX, `_handleDoorEvent failed, no door name supplied.`);
      return Promise.reject(new Error('invalid_param'));
    }
    if (!['OPEN', 'CLOSED'].includes(doorState)) {
      const msg = `_handleDoorEvent(${doorName}) failed, invalid door state:`;
      log.error(LOG_PREFIX, `${msg} ${doorState}`);
      return Promise.reject(new Error('invalid_param'));
    }
    if (_self.state.doors && _self.state.doors[doorName] === doorState) {
      log.info(LOG_PREFIX, `Door debouncer, door already ${doorState}`);
      return Promise.resolve('debounced');
    }
    // Mark the door as opened
    _fbSet(`state/doors/${doorName}`, doorState);
    // If the system is away, change it to home
    if (_self.state.systemState === 'AWAY' && doorState === 'OPEN') {
      _setState('HOME');
      _announceDoorOpened(doorName);
    }
    // Log the door open/close event.
    const now = Date.now();
    const nowPretty = log.formatTime(now);
    const msg = `${doorName} door ${doorState}`;
    const doorLogObj = {
      level: 'INFO',
      message: msg,
      doorName: doorName,
      state: doorState,
      date: now,
      date_: nowPretty,
    };
    _fbPush('logs/doors', doorLogObj);
    log.debug(LOG_PREFIX, msg);
    return Promise.resolve(doorLogObj);
  }

  /**
   * Sends an announcement when the door has been opened.
   *
   * @param {string} doorName The name of the door.
   */
  function _announceDoorOpened(doorName) {
    if (_doorOpenAccounceTimer) {
      // timer has already started, we'll ignore this second notification
      return;
    }
    if (!_config.presenceAlarm) {
      return;
    }
    if (!_self.state.presence || !_self.state.presence.state) {
      return;
    }
    log.debug(LOG_PREFIX, `_doorOpenAccounceTimer('${doorName}')`);
    const presenceAlarmTimeout = _config.presenceAlarm.timeout;
    _doorOpenAccounceTimer = setTimeout(() => {
      _doorOpenAccounceTimer = null;
      if (_self.state.presence.state === 'NONE') {
        log.warn(LOG_PREFIX, `${doorName} opened, but no one was present.`);
        const cmdName = _config.presenceAlarm.cmdName;
        if (cmdName) {
          _self.executeCommandByName(cmdName, 'doorAlarm');
        }
      }
    }, presenceAlarmTimeout);
  }

  /**
   * Plays a sound
   *
   * @param {String} file The audio file to play
   * @param {Object} opts Options object
   * @return {Promise} A promise that resolves to the result of the request
   */
  function _playSound(file, opts) {
    opts = opts || {};
    if (!file) {
      log.error(LOG_PREFIX, `playSound failed, no file specified.`);
      return Promise.reject(new Error('no_file'));
    }
    const now = Date.now();
    if (now - _lastSoundPlayedAt < (20 * 1000) && opts.force !== true) {
      log.verbose(LOG_PREFIX, 'playSound skipped, too soon.');
      return Promise.reject(new Error('too_soon'));
    }
    if (_self.state.doNotDisturb === true && opts.force !== true) {
      log.verbose(LOG_PREFIX, 'playSound skipped, do not disturb.');
      return Promise.reject(new Error('do_not_disturb'));
    }
    _lastSoundPlayedAt = now;
    log.debug(LOG_PREFIX, `playSound('${file}', ...)`, opts);
    return _playSoundLocal(file);
  }

  /**
   * Plays a sound through the local speaker
   *
   * @param {String} file The audio file to play
   * @return {Promise} A promise that resolves to the result of the request
   */
  function _playSoundLocal(file) {
    const title = `playSoundLocal('${file}')`;
    const cmd = `mplayer ${file}`;
    return honExec.run(title, cmd, '.', true);
  }

  /**
   * Uses Google Home to speak
   *
   * @param {String} utterance The words to say
   * @param {Object} opts Options
   * @return {Promise} A promise that resolves to the result of the request
   */
  function _sayThis(utterance, opts) {
    return Promise.reject(new Error('Not Implemented'));
    // const force = !!opts.force;
    // if (!utterance) {
    //   log.error(LOG_PREFIX, 'sayThis failed, no utterance provided.');
    //   return Promise.reject(new Error('no_utterance'));
    // }
    // if (!googleHome) {
    //   log.error(LOG_PREFIX, 'Unable to speak, Google Home not available.');
    //   return Promise.reject(new Error('gh_not_available'));
    // }
    // log.debug(LOG_PREFIX, `sayThis('${utterance}', ${force})`);
    // if (_self.state.doNotDisturb === false || force === true) {
    //   return googleHome.say(utterance);
    // }
    // return Promise.reject(new Error('do_not_disturb'));
  }

  /**
   * Sets the Do Not Disturb property
   *
   * @param {boolean} val Turn do not disturb on/off
   * @return {Promise} A promise that resolves to the result of the request
   */
  function _setDoNotDisturb(val) {
    val = !!val;
    log.debug(LOG_PREFIX, `setDoNotDisturb(${val})`);
    _fbSet('state/doNotDisturb', val);
    return Promise.resolve({doNotDisturb: val});
  }

  /**
   * Ring the doorbell
   *
   * @param {String} source Where doorbell was rung/sender
   * @return {Object}
   */
  function _ringDoorbell(source) {
    // Note current simte
    const now = Date.now();

    // Play the doorbell sound
    const soundFile = _config.doorbell.soundFile;
    _playSoundLocal(soundFile);

    // Execute any additional steps
    const command = _config.commands.RUN_ON_DOORBELL;
    if (command && command.actions && command.actions.length > 0) {
      _self.executeActions(command.actions, `DOORBELL_${source}`);
    }

    // Log the doorbell was run
    const details = {
      date: now,
      date_: log.formatTime(now),
      source: source,
    };
    log.verbose(LOG_PREFIX, `Doorbell from ${source}`, details);
    _fbSet('state/lastDoorbell', details);
    return Promise.resolve({doorbell: source});
  }

  /**
   * Change the system state (HOME/AWAY/ARMED)
   *
   * @param {String} newState The new state to set the house to
   * @return {Promise} A promise that resolves to the result of the request
   */
  function _setState(newState) {
    const msg = `setState('${newState}')`;
    if (_self.state.systemState === newState) {
      log.warn(LOG_PREFIX, `${msg} aborted, already '${newState}'`);
      return Promise.resolve({state: newState});
    }
    if (!['HOME', 'ARMED', 'AWAY'].includes(newState)) {
      log.error(LOG_PREFIX, `${msg} failed, invalid state: ${newState}`);
      return Promise.reject(new Error('invalid_state'));
    }

    log.log(LOG_PREFIX, `setState('${newState}')`);
    // Is there an arming timer running?
    if (_armingTimer) {
      clearTimeout(_armingTimer);
      _armingTimer = null;
    }
    // If the new state is armed, set up an arming timer
    if (newState === 'ARMED') {
      _armingTimer = setTimeout(() => {
        _armingTimer = null;
        _setState('AWAY');
      }, _config.armingDelay || 90000);
    }
    // Set the new state
    _fbSet('state/systemState', newState);
    const now = Date.now();
    const stateLog = {
      level: 'INFO',
      message: newState,
      state: newState,
      date: now,
      date_: log.formatTime(now),
    };
    _fbPush('logs/systemState', stateLog);
    _self.executeCommandByName(`RUN_ON_${newState}`, 'SET_STATE');
    return Promise.resolve(newState);
  }

  /** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** **
   *
   * Conditions checks for actions
   *
   ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** **/

  /**
   * Checks if the conditions are met
   *
   * @param {Object} conditions - Conditions to check, all conditions
   *                              must be met in order for the rule to pass.
   * @return {boolean} True if all conditions are met.
   */
  function _checkConditions(conditions) {
    if (typeof conditions !== 'object') {
      const msg = `checkConditions failed, invalid conditions.`;
      log.error(LOG_PREFIX, msg, conditions);
      return false;
    }

    if (conditions.skip === true) {
      return false;
    }

    // Check if the time range conditions are met.
    if (conditions.timeRange) {
      const inRange = _inRange(conditions.timeRange);
      if (inRange === false) {
        return false;
      }
    }

    // Check if the system state is as expected.
    if (conditions.systemState) {
      if (!_self.state.systemState) {
        const msg = `checkConditions failed, unable to check systemState.`;
        log.exception(LOG_PREFIX, msg);
        return false;
      }
      const currentState = _self.state.systemState;
      const states = _arrayify(conditions.systemState);
      if (!states.includes(currentState)) {
        return false;
      }
    }

    // Check if the number of people present is as expected.
    if (conditions.presence) {
      if (!_self.state.presence || !_self.state.presence.state) {
        const msg = `checkConditions failed, unable to check presenceState.`;
        log.exception(LOG_PREFIX, msg);
        return false;
      }
      const currentPresence = _self.state.presence.state;
      const presence = _arrayify(conditions.presence);
      if (!presence.includes(currentPresence)) {
        return false;
      }
    }

    // No conditions failed, return true.
    return true;
  }

  /**
   * Checks if the current time is between the specified range
   *
   * @param {string} range - Format smtwtfsThh:hhDmm.
   *                         - 0-6: days to run, use '-' to skip day.
   *                         - 7: Must be 'T'.
   *                         - 8-12: Time to start 24 hr format, eg 23:30.
   *                         - 13: Must be 'D'.
   *                         - 14+: Number of minutes the duration lasts.
   *                         - EG: '---X---T23:30D60'
   * @return {boolean}
   */
  function _inRange(range) {
    const RE_RANGE = /^(.{7})T(\d\d):(\d\d)D(\d+)$/;
    const matched = range.match(RE_RANGE);
    if (!matched || matched.length !== 5) {
      return false;
    }
    const maDay = matched[1];
    const maHour = matched[2];
    const maMinute = matched[3];
    const maDuration = parseInt(matched[4]);
    const now = moment().second(0).millisecond(0);
    const tomorrow = now.clone().hour(0).minute(0).add(1, 'day');

    const mStart = now.clone().hour(maHour).minute(maMinute);
    const mStop = mStart.clone().add(maDuration, 'minutes');

    if (mStop.isAfter(tomorrow)) {
      const numMinIntoDay = moment.duration(tomorrow.diff(now)).asMinutes();
      if (numMinIntoDay > maDuration) {
        mStart.subtract(1, 'day');
        mStop.subtract(1, 'day');
      }
    }
    if (maDay[mStart.isoWeekday() % 7] === '-') {
      return false;
    }
    if (now.isBetween(mStart, mStop)) {
      return true;
    }
    return false;
  }

  /** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** **
   *
   * Delayed Command Handlers
   *
   ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** **/

  /**
   * Run a command on a delay.
   *
   * @param {Object} action Command to run
   * @param {String} source Where the command was sent from.
   */
  function _runDelayedCommand(action, source) {
    // Get the CounterID
    const id = (_delayedCmdCounter++).toString();

    // Figure out the delay
    const runDelay = action.delay * 1000;
    delete action.delay;

    // Schedule the task
    const delayTimer = setTimeout(() => {
      log.debug(LOG_PREFIX, `DelayedCommand: '${id}' running`);
      _self.executeActions(action, `delayedCommands/${id}`);
      _clearDelayedCommand(id);
    }, runDelay);

    // Save the task to the log
    _delayedCmdTimers[id] = delayTimer;

    // Store and log the scheduled command
    const msg = `DelayedCommand: '${id}' scheduled in ` +
      `${runDelay / 1000} seconds.`;
    const now = Date.now();
    const details = {
      now: now,
      delay: runDelay,
      runAt: now + runDelay,
      action: action,
      source: source,
    };
    log.debug(LOG_PREFIX, msg, details);
    _fbSet(`state/delayedCommands/${id}`, details);
  }

  /**
   * Cancels and clears the timer
   *
   * @param {String} id ID of the timer
   */
  function _cancelDelayedCommand(id) {
    const timeout = _delayedCmdTimers[id];
    if (timeout) {
      clearTimeout(timeout);
    }
    _clearDelayedCommand(id);
  }

  /**
   * Clears the timer from the list of in progress timers.
   *
   * @param {String} id ID of the timer
   */
  function _clearDelayedCommand(id) {
    _fbSet(`state/delayedCommands/${id}`, null);
    delete _delayedCmdTimers[id];
  }


  /** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** **
   *
   * AppleTV API
   *
   ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** **/

  /**
   * Init the AppleTV API
   */
  function _initAppleTV() {
    _fbSet('state/appleTV', false);

    if (_config.appleTV.disabled === true) {
      log.warn(LOG_PREFIX, 'AppleTV disabled via config.');
      return;
    }

    const credentials = _config.appleTV.credentials;
    if (!credentials) {
      log.error(LOG_PREFIX, 'AppleTV unavailable, no credentials provided.');
      return;
    }

    appleTV = new AppleTV();
    appleTV.on('found', () => {
      appleTV.connect(credentials);
    });
    appleTV.on('nowPlaying', (info) => {
      _fbSet('state/appleTV/nowPlaying', info);
    });
    appleTV.on('playbackQueue', (info) => {
      _fbSet('state/appleTV/playbackQueue', info);
    });
    appleTV.on('supportedCommands', (info) => {
      _fbSet('state/appleTV/supportedCommands', info);
    });
  }

  /** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** **
   *
   * Alarm Clock API
   *
   ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** **/

  /**
   * Init the Alarm Clock API
   */
  function _initAlarmClock() {
    _fbSet('state/alarmClock', false);

    alarmClock = new AlarmClock();

    alarmClock.on('alarm_changed', (key, details) => {
      const clone = Object.assign({}, details);
      const repeat = [];
      try {
        if (!clone.repeatDays) {
          clone.repeatDays = '-------';
        }
        clone.repeatDays.split('').forEach((day) => {
          if (day && day.toLowerCase() === 'x') {
            repeat.push(true);
          } else {
            repeat.push(false);
          }
        });
        clone.repeatDays = repeat;
        _fbSet(`state/alarmClock/${key}`, clone);
      } catch (ex) {
        const data = {
          details: details,
          clone: clone,
          repeat: repeat,
          ex: {
            name: ex.name,
            message: ex.message,
          },
        };
        if (ex.stack) {
          data.ex.stack = ex.stack;
        }
        log.exception(LOG_PREFIX, `alarmChanged failed`, data);
      }
    });

    alarmClock.on('alarm_removed', (key) => {
      _fbSet(`state/alarmClock/${key}`, null);
    });

    alarmClock.on('alarm', (key, details) => {
      log.debug(LOG_PREFIX, `Alarm fired: ${key}`, details);
      if (details.hasOwnProperty('cmdName')) {
        _self.executeCommandByName(details.cmdName, `alarm-${key}`);
      } else {
        log.error(LOG_PREFIX, 'Unknown alarm command', details);
      }
    });
  }


  /** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** **
   *
   * Auto Humidifier API
   *
   ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** **/

  // /**
  //   * Init the auto humidifier
  //   */
  // function _initAutoHumidifier() {
  //   setTimeout(() => {
  //     log.init(LOG_PREFIX, 'Starting autoHumidifier...');
  //     _autoHumidifierTick();
  //   }, 90 * 1000);

  //   setInterval(() => {
  //     _autoHumidifierTick();
  //   }, 5 * 60 * 1000);
  // }

  // /**
  //   *
  //   */
  // function _autoHumidifierTick() {
  //   // Only run when at home
  //   if (_self.state.systemState !== 'HOME') {
  //     // log.verbose(LOG_PREFIX, `autoHumidifier: not HOME`);
  //     return;
  //   }
  //   // Only run if enabled
  //   if (_config.hvac.autoHumidifier.disabled === true) {
  //     // log.verbose(LOG_PREFIX, `autoHumidifier: disabled`);
  //     return;
  //   }

  //   // Loop through each room
  //   _config.hvac.autoHumidifier.rooms.forEach((room) => {
  //     try {
  //       const msgBase = `autoHumidifier[${room.name}]`;

  //       // Get the current humidity
  //       const path = room.pathToValue;
  //       const humidity = Math.round(parseFloat(_getStateValue(path)));
  //       if (Number.isNaN(humidity)) {
  //         log.warn(LOG_PREFIX, `${msgBase}: Unable to get humidity`, room);
  //         return;
  //       }
  //       // Check the current Wemo state
  //       const currentWemoState = _self.state.wemo[room.wemoId].value == true;

  //       // Setup the action we'll send
  //       const action = {};

  //       // Check the humidity, turn off if it's above...
  //       if (humidity > parseInt(_config.hvac.autoHumidifier.offAbove)) {
  //         action.wemo = {on: false};
  //         // log.verbose(LOG_PREFIX, `${msgBase}: on:false`);
  //       }
  //       // Check the humidity, turn off if it's above...
  //       if (humidity < parseInt(_config.hvac.autoHumidifier.onBelow)) {
  //         action.wemo = {on: true};
  //         // log.verbose(LOG_PREFIX, `${msgBase}: on:true`);
  //       }

  //       // No change to current state
  //       if (!action.wemo) {
  //         log.verbose(LOG_PREFIX, `${msgBase}: within range, no change`);
  //         return;
  //       }

  //       // If the Wemo is already in the expected state, no change required.
  //       if (action.wemo.on === currentWemoState) {
  //         log.verbose(LOG_PREFIX, `${msgBase}: already on/off`);
  //         return;
  //       }

  //       // Log details
  //       const info = {
  //         currentHumidity: humidity,
  //         currentWemoState: currentWemoState,
  //       };
  //       log.log(LOG_PREFIX, `${msgBase} changed  '${action.wemo.on}'`, info);

  //       // Turn the humidifier on/off
  //       action.wemo.id = room.wemoId;
  //       _executeAction(action, 'AutoHumidifier');
  //     } catch (ex) {
  //       log.exception(LOG_PREFIX, `Error in autoHumidifierTick`, ex);
  //     }
  //   });
  // }


  /** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** **
   *
   * Awair API
   *
   ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** **/

  /**
   * Init the Awair API
   */
  async function _initAwair() {
    _fbSet('state/awair', false);

    if (_config.awair.disabled === true) {
      log.warn(LOG_PREFIX, 'Cron disabled via config.');
      return;
    }

    const token = _config.awair.key;
    if (!token) {
      log.error(LOG_PREFIX, 'Awair unavailable, no token specified.');
      return;
    }
    awair = new Awair(token);
    awair.on('device_found', (key, device) => {
      _fbSet(`state/awair/${key}`, device);
    });
    awair.on('settings_changed', (key, settings) => {
      _fbSet(`state/awair/${key}/settings`, settings);
    });
    awair.on('data_changed', (key, data) => {
      _fbSet(`state/awair/${key}/data`, data);
    });
    awair.on('sensors_changed', (key, data) => {
      _fbSet(`state/awair/local/${key}`, data);
    });
    const fbAwairPath = 'config/HomeOnNode/awair/devices';
    const fbAwairRef = await FBHelper.getRef(fbAwairPath);
    fbAwairRef.on('child_added', (snapshot) => {
      const deviceId = snapshot.key;
      const ipAddress = snapshot.val();
      awair.monitorLocalDevice(deviceId, ipAddress);
    });
  }


  /** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** **
   *
   * Bluetooth API
   *
   ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** **/

  /**
   * Init the Bluetooth API
   */
  function _initBluetooth() {
    _fbSet('state/bluetooth', false);

    if (_config.bluetooth.disabled === true) {
      log.warn(LOG_PREFIX, 'Bluetooth disabled via config.');
      return;
    }

    bluetooth = new Bluetooth();
    bluetooth.on('scanning', (scanning) => {
      _fbSet('state/bluetooth/scanning', scanning);
    });
    bluetooth.on('adapter_state', (adapterState) => {
      _fbSet('state/bluetooth/adapterState', adapterState);
    });
  }

  /**
   * Shutdown the Bluetooth Services
   */
  function _shutdownBluetooth() {
    if (bluetooth) {
      bluetooth.stopScanning();
    }
  }


  /** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** **
   *
   * Cron Job
   *
   ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** **/

  /**
   * Init Cron API
   */
  function _initCron() {
    if (_config.cron.disabled === true) {
      log.warn(LOG_PREFIX, 'Cron disabled via config.');
      return;
    }

    try {
      logging = new Logging();
      const cronSchedule = '0 0,5,10,15,20,25,30,35,40,45,50,55 * * * *';
      new CronJob(cronSchedule, () => {
        logging.saveData(_self.state);
      }, null, true, 'America/New_York');
    } catch (ex) {
      log.exception(LOG_PREFIX, 'Unable to initialize Cron', ex);
    }
  }


  /** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** **
   *
   * Harmony API
   *
   ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** **/

  /**
   * Init Harmony API
   */
  async function _initHarmony() {
    await _fbSet('state/harmony', false);

    if (_config.harmony.disabled === true) {
      log.warn(LOG_PREFIX, 'Harmony disabled via config.');
      return;
    }

    const ip = _config.harmony.ipAddress;
    if (!ip) {
      log.error(LOG_PREFIX, `Harmony unavailable, no IP address specified.`);
      return;
    }
    harmony = await new Harmony(ip);
    harmony.on('hub_info', (data) => {
      _fbSet('state/harmony/info', data);
    });
    harmony.on('activity_changed', (activity) => {
      _fbSet('state/harmony/activity', activity);
      if (activity && activity.label) {
        const honCmdName = `HARMONY_${activity.label.toUpperCase()}`;
        if (_config.commands[honCmdName]) {
          _self.executeCommandByName(honCmdName, 'Harmony');
        }
      }
    });
    harmony.on('config_changed', (config) => {
      _fbSet('state/harmony/config', config);
    });
    harmony.on('state_notify', (data) => {
      _fbSet('state/harmony/state', data);
    });
    harmony.on('metadata_notify', (data) => {
      _fbSet('state/harmony/meta', data);
    });
  }

  /**
   * Shutdown the Harmony API
   */
  function _shutdownHarmony() {
    log.log(LOG_PREFIX, 'Shutting down Harmony.');
    if (harmony) {
      harmony.close();
    }
    harmony = null;
  }


  /** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** **
   *
   * Philips Hue API
   *
   ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** **/

  /**
   * Init Hue
   */
  async function _initHue() {
    await _fbSet('state/hue', null);

    if (_config.philipsHue.disabled === true) {
      log.warn(LOG_PREFIX, 'Hue disabled via config.');
      return;
    }

    const apiKey = _config.philipsHue.key;
    const hueIP = _config.philipsHue.ipAddress;
    if (!apiKey || !hueIP) {
      log.error(LOG_PREFIX, `Hue unavailable, no API key or IP available.`);
      return;
    }

    hue = await new Hue(apiKey, hueIP);
    hue.on('config_changed', (config) => {
      _fbSet('state/hue', config);
    });
    hue.on('lights_changed', (lights) => {
      _fbSet('state/hue/lights', lights);
    });
    hue.on('groups_changed', (groups) => {
      _fbSet('state/hue/groups', groups);
    });
    hue.on('sensors_changed', (sensors) => {
      _fbSet('state/hue/sensors', sensors);
    });
    hue.on('rules_changed', (rules) => {
      _fbSet('state/hue/rules', rules);
    });
    hue.on('sensor_unreachable', (sensor) => {
      const msg = {
        message: 'Hue sensor unreachable',
        level: 5,
        date: Date.now(),
        extra: sensor,
      };
      _fbPush('logs/messages', msg);
    });
    hue.on('sensor_low_battery', (sensor) => {
      const msg = {
        message: 'Hue sensor low battery',
        level: 5,
        date: Date.now(),
        extra: sensor,
      };
      _fbPush('logs/messages', msg);
    });
  }

  /**
   * Retreive the hue receipe for setting lights
   *
   * @param {String} receipeName the name of the light receipe to get
   * @return {Object} The command to send to Hue
   */
  function _getLightReceipeByName(receipeName) {
    const receipe = _config.lightScenes[receipeName];
    if (receipe && receipe.hue) {
      return receipe.hue;
    }
    return null;
  }


  /** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** **
   *
   * LG TV API
   *
   ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** **/

  /**
   * Init the LG TV API
   */
  function _initLGTV() {
    _fbSet('state/lgTV', false);

    const lgConfig = _config.lgTV;
    if (lgConfig.disabled === true) {
      log.warn(LOG_PREFIX, 'LG TV disabled via config.');
      return;
    }

    if (!lgConfig || !lgConfig.ipAddress || !lgConfig.key) {
      log.error(LOG_PREFIX, `LG TV unavailable, no config`, lgConfig);
      return;
    }

    lgTV = new LGTV(lgConfig.ipAddress, lgConfig.key);
    lgTV.on('connected', (val) => {
      _fbSet('state/lgTV/connected', val);
    });
    lgTV.on('ready', (val) => {
      _fbSet('state/lgTV/ready', val);
    });
    lgTV.on('systemInfo', (val) => {
      _fbSet('state/lgTV/systemInfo', val);
    });
    lgTV.on('swInfo', (val) => {
      _fbSet('state/lgTV/swInfo', val);
    });
    lgTV.on('services', (val) => {
      _fbSet('state/lgTV/services', val);
    });
    lgTV.on('launchPoints', (val) => {
      _fbSet('state/lgTV/launchPoints', val);
    });
    lgTV.on('inputs', (val) => {
      _fbSet('state/lgTV/inputs', val);
    });
    lgTV.on('powerState', (val) => {
      _fbSet('state/lgTV/powerState', val);
    });
    lgTV.on('currentAppId', (val) => {
      _fbSet('state/lgTV/currentAppId', val);
    });
    lgTV.on('volume', (val) => {
      _fbSet('state/lgTV/volume', val);
    });
    lgTV.on('muted', (val) => {
      _fbSet('state/lgTV/muted', val);
    });
    lgTV.on('soundOutput', (val) => {
      _fbSet('state/lgTV/soundOutput', val);
    });
    lgTV.on('currentChannel', (val) => {
      _fbSet('state/lgTV/currentChannel', val);
    });
  }

  /**
   * Shut down the LGTV service
   */
  function _shutdownLGTV() {
    if (lgTV) {
      lgTV.shutdown();
    }
  }


  /** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** **
   *
   * NanoLeaf API
   *
   ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** **/

  /**
   * Init NanoLeaf
   */
  async function _initNanoLeaf() {
    await _fbSet('state/nanoLeaf', null);

    if (_config.nanoLeaf.disabled === true) {
      log.warn(LOG_PREFIX, 'NanoLeaf disabled via config.');
      return;
    }

    const ip = _config.nanoLeaf.ip;
    const port = _config.nanoLeaf.port || 16021;
    const apiKey = _config.nanoLeaf.key;
    if (!apiKey) {
      log.error(LOG_PREFIX, `NanoLeaf unavailable, no API key available.`);
      return;
    }
    if (!ip || !port) {
      log.error(LOG_PREFIX, `NanoLeaf unavailable, no IP or port specified.`);
      return;
    }
    nanoLeaf = new NanoLeaf(apiKey, ip, port);
    nanoLeaf.on('state_changed', (state) => {
      _fbSet('state/nanoLeaf', state);
    });
  }


  /** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** **
   *
   * Notification System API
   *
   ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** **/

  /**
   * Initialize the Notification System
   */
  async function _initNotifications() {
    const fbNotRef = await FBHelper.getRef('state/hasNotification');
    fbNotRef.on('value', (snapshot) => {
      if (snapshot.val()) {
        _self.executeCommandByName('NEW_NOTIFICATION', 'HOME');
        log.log(LOG_PREFIX, 'New notification received.');
        snapshot.ref.set(false);
      }
    });
  }


  /** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** **
   *
   * Presence API
   *
   ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** **/

  /**
   * Init Presence
   */
  async function _initPresence() {
    _fbSet('state/presence/state', 'NONE');

    if (!bluetooth) {
      log.warn(LOG_PREFIX, 'Presence disabled, no bluetooth available.');
      return;
    }

    presence = new Presence(bluetooth);
    // Set up the presence detection
    presence.on('change', _presenceChanged);
    const fbPresPath = 'config/HomeOnNode/presence';
    const fbPresencePeopleRef = await FBHelper.getRef(fbPresPath);

    fbPresencePeopleRef.on('child_added', (snapshot) => {
      const uuid = snapshot.key;
      presence.add(uuid, snapshot.val());
    });
    fbPresencePeopleRef.on('child_removed', (snapshot) => {
      const uuid = snapshot.key;
      presence.remove(uuid);
    });
    fbPresencePeopleRef.on('child_changed', (snapshot) => {
      const uuid = snapshot.key;
      presence.update(uuid, snapshot.val());
    });
  }

  /**
   * Presence Changed
   *
   * @param {Object} person The person who's presence changed.
   * @param {Number} numPresent The number of people present.
   * @param {Object} who The list of who is present
   */
  function _presenceChanged(person, numPresent, who) {
    const presenceLog = {
      level: 'INFO',
      message: person.name + ' is ' + person.state,
      name: person.name,
      state: person.state,
      date: person.lastSeen,
    };
    _fbPush('logs/presence', presenceLog);
    _fbSet('state/presence/people', who);
    let presenceState = 'SOME';
    if (numPresent === 0) {
      presenceState = 'NONE';
    }
    _fbSet('state/presence/state', presenceState);
    _self.executeCommandByName(`PRESENCE_${presenceState}`, 'PRESENCE');
  }


  /** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** **
   *
   * PushBullet API
   *
   ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** **/

  /**
   * Init Push Bullet
   */
  function _initPushBullet() {
    if (_config.pushBullet.disabled === true) {
      log.warn(LOG_PREFIX, 'PushBullet disabled via config.');
      return;
    }

    const apiKey = _config.pushBullet.key;
    if (!apiKey) {
      log.error(LOG_PREFIX, `PushBullet unavailable, no API key available.`);
      return;
    }
    pushBullet = new PushBullet(apiKey);
    pushBullet.on('notification', _receivedPushBulletNotification);
  }

  /**
   * Handle incoming PushBullet notification
   *
   * @param {Object} msg Incoming message
   */
  function _receivedPushBulletNotification(msg) {
    if (!_config.pushBullet.notificationTypes) {
      log.warn(LOG_PREFIX, `No notification types defined.`, msg);
      return;
    }
    const msgAppName = msg.application_name;
    if (!msgAppName) {
      return;
    }
    const cmdName = _config.pushBullet.notificationTypes[msgAppName];
    if (cmdName) {
      _self.executeCommandByName(cmdName, 'PushBullet');
    }
  }

  /**
   * Shutdown PushBullet
   */
  function _shutdownPushBullet() {
    if (pushBullet) {
      pushBullet.shutdown();
    }
    pushBullet = null;
  }


  /** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** **
   *
   * Sonos API
   *
   ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** **/

  /**
   * Init Sonos
   */
  async function _initSonos() {
    await _fbSet('state/sonos', false);

    if (_config.sonos.disabled === true) {
      log.warn(LOG_PREFIX, 'Sonos disabled via config.');
      return;
    }

    sonos = await new Sonos();
    sonos.on('player-state', (playerState) => {
      playerState = JSON.parse(JSON.stringify(playerState));
      _fbSet('state/sonos/state', playerState);
    });
    sonos.on('favorites-changed', (favorites) => {
      favorites = JSON.parse(JSON.stringify(favorites));
      _fbSet('state/sonos/favorites', favorites);
    });

    // Nothing of interest in storing this data, most of it is covered in
    // player-state
    sonos.on('transport-state', (state) => {
      try {
        state = JSON.parse(JSON.stringify(state));
        _fbSet('state/sonos/transportState', state);
      } catch (ex) {
        log.debug(LOG_PREFIX, 'Unable to save Sonos transport state', ex);
      }
    });
    // Nothing interesting here either....
    // sonos.on('topology-changed', (topology) => {
    //   try {
    //     topology = JSON.parse(JSON.stringify(topology));
    //     _fbSet('state/sonos/topology', topology);
    //   } catch (ex) {
    //     log.debug(LOG_PREFIX, 'Unable to save Sonos topology', ex);
    //   }
    // });

    // single vol
    sonos.on('volume-changed', (val) => {
      const roomName = val.roomName;
      const vol = val.newVolume;
      _fbSet(`state/sonos/speakerState/${roomName}/volume`, vol);
    });
    // group vol
    sonos.on('group-volume', (val) => {
      const vol = val.newVolume;
      const roomName = val.roomName;
      _fbSet(`state/sonos/speakerState/_group/volume`, vol);
      _fbSet(`state/sonos/speakerState/_group/controller`, roomName);
    });
    // single mute
    sonos.on('mute-changed', (val) => {
      const isMuted = val.newMute;
      const roomName = val.roomName;
      _fbSet(`state/sonos/speakerState/${roomName}/isMuted`, isMuted);
    });
    // group mute
    sonos.on('group-mute', (val) => {
      const isMuted = val.newMute;
      const roomName = val.roomName;
      _fbSet(`state/sonos/speakerState/_group/isMuted`, isMuted);
      _fbSet(`state/sonos/speakerState/_group/controller`, roomName);
    });
  }


  /** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** **
   *
   * TiVo API
   *
   ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** **/

  /**
   * Init TiVo
   */
  function _initTivo() {
    _fbSet('state/tivo', false);

    if (_config.tivo.disabled === true) {
      log.warn(LOG_PREFIX, 'TiVo disabled via config.');
      return;
    }

    const tivoIP = _config.tivo.ip;
    if (!tivoIP) {
      log.warn(LOG_PREFIX, `TiVo unavailable, no IP address specified.`);
      return;
    }
    tivo = new Tivo(tivoIP);
    tivo.on('data', (data) => {
      _fbSet('state/tivo/data', data);
    });
  }

  /**
   * Shutdown the Tivo API
   */
  function _shutdownTivo() {
    log.log(LOG_PREFIX, 'Shutting down Tivo.');
    if (tivo) {
      tivo.close();
    }
    tivo = null;
  }


  /** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** **
   *
   * Weather API
   *
   ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** **/

  /**
   * Init Weather
   */
  function _initWeather() {
    _fbSet('state/weather', false);

    if (_config.forecastIO.disabled === true) {
      log.warn(LOG_PREFIX, 'Weather disabled via config.');
      return;
    }

    const apiKey = _config.forecastIO.key;
    if (!apiKey) {
      log.error(LOG_PREFIX, `ForecastIO unavailable, no API key available.`);
      return;
    }
    weather = new Weather(_config.forecastIO.latLon, apiKey);
    weather.on('weather', (forecast) => {
      _fbSet('state/weather', forecast);
    });
  }


  /** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** **
   *
   * Wemo API
   *
   ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** **/

  /**
   * Init Wemo
   */
  function _initWemo() {
    _fbSet('state/wemo', false);

    if (_config.wemo.disabled === true) {
      log.warn(LOG_PREFIX, 'Wemo disabled via config.');
      return;
    }

    wemo = new Wemo();
    wemo.on('device_found', (id, data) => {
      _fbSet(`state/wemo/${id}`, data);
    });
    wemo.on('change', (id, data) => {
      _fbSet(`state/wemo/${id}`, data);
    });
    wemo.on('error', (err) => {
      log.error(LOG_PREFIX, `Ignored Wemo error`, err);
    });
  }


  /** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** **
   *
   * Initialize the whole thing
   *
   ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** **/

  _init();
}

util.inherits(Home, EventEmitter);

module.exports = Home;
