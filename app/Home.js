'use strict';

const EventEmitter = require('events').EventEmitter;
const util = require('util');

const Hue = require('./Hue');
const LGTV = require('./LGtv');
const Wemo = require('./Wemo');
const Sonos = require('./Sonos');
const Awair = require('./Awair');
const moment = require('moment');
const log = require('./SystemLog2');
const AppleTV = require('./AppleTV');
const Logging = require('./Logging');
const honExec = require('./HoNExec');
const GCMPush = require('./GCMPush');
const HueSync = require('./HueSync');
const fsProm = require('fs/promises');
const WSClient = require('./WSClient');
const Weather = require('./Weather');
const NanoLeaf = require('./NanoLeaf');
const Presence = require('./Presence');
const CronJob = require('cron').CronJob;
const Bluetooth = require('./Bluetooth');
const AlarmClock = require('./AlarmClock');
const GoogDeviceAccess = require('./GDevAccess');

const deepDiff = require('deep-diff').diff;

const FBHelper = require('./FBHelper');

const LOG_PREFIX = 'HOME';

/**
 * Home API
 * @constructor
 */
function Home() {
  const _self = this;
  _self.state = {};
  _self.config = {};

  let _config;
  let _fbRootRef;

  let alarmClock;
  let appleTV;
  let awair;
  let bedJetWSClient;
  let bluetooth;
  let gcmPush;
  let hue;
  let hueSync;
  let googDeviceAccess;
  let lgTV;
  let logging;
  let nanoLeaf;
  let presence;
  let sonos;
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
      _self.config = Object.assign({}, _config);
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
      hasNotifications: false,
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
      sun: {
        rise: 0,
        set: 0,
      },
    };

    if (_fbRootRef) {
      const fbState = await _fbRootRef.child('state');
      await fbState.child('time').set(_self.state.time);
      await fbState.child('delayedCommands').remove();
      const fbPrevStateSnap = await fbState.once('value');
      const fbPrevState = fbPrevStateSnap.val();
      log.log(LOG_PREFIX, 'Updating state based on previous state.');
      _self.state.doNotDisturb = fbPrevState.doNotDisturb;
      _self.state.hasNotifications = fbPrevState.hasNotifications;
      _self.state.systemState = fbPrevState.systemState;
    } else {
      log.error(LOG_PREFIX, `No fbRootRef, can't get prev state`);
      // When FB ref is available, write current state to Firebase.
      _updateFBState();
    }

    _initNotifications();
    gcmPush = await new GCMPush();

    await _initHue();
    await _initAlarmClock();
    await _initNanoLeaf();
    await _initHueSync();
    await _initSonos();
    await _initWeather();
    await _initWemo();
    await _initAwair();
    await _initLGTV();
    await _initAppleTV();
    await _initBluetooth();
    await _initPresence();
    await _initBedJet();
    await _initGoogDeviceAccess();

    _initCron();
    _initAutoHumidifier();

    _self.emit('ready');
    log.log(LOG_PREFIX, 'Ready');
    if (_config.readySound) {
      _playSound(_config.readySound).catch((err) => {
        log.error(LOG_PREFIX, 'Unable to play start up sound.', err);
      });
    }

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
          _self.config = Object.assign({}, _config);
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
   * Called when _fbRef isn't available, it waits for Firebase ref to
   * become available, then writes current state to Firebase.
   */
  async function _updateFBState() {
    try {
      _fbRootRef = await FBHelper.getRootRefUnlimited();
      const state = await _fbRootRef.child('state');
      await state.set(_self.state);
    } catch (ex) {
      log.exception(LOG_PREFIX, 'Failed to write state to Firebase.', ex);
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
      log.warn(LOG_PREFIX, `Command '${commandName}' not found.`);
      return;
    }

    // Ensure the command is not disabled.
    if (command.disabled) {
      log.warn(LOG_PREFIX, `Command '${commandName}' is disabled.`, command);
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

      // No op - skip the action.
      if (action.hasOwnProperty('noop')) {
        results.push(_genResult(action, true, 'noop'));
        return;
      }

      // Disabled - skip the action.
      if (action.disabled) {
        results.push(_genResult(action, true, 'disabled'));
        return;
      }

      // Run the action on a delay.
      if (action.delay) {
        _scheduleDelayedCommand(action, source);
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
    _shutdownBedJet();
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

    // Verify there is only one action per action.
    const k = Object.keys(action);
    if (k.length === 1) {
      log.log(LOG_PREFIX, `executeAction('${k[0]}', '${source}')`, action);
    } else {
      const keys = k.join(', ');
      log.error(LOG_PREFIX, `executeAction([${keys}], '${source}')`, action);
      return _genResult(action, false, 'num_param_exceeded');
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
      return appleTV.execute(action.appleTV)
          .then((result) => {
            return _genResult(action, true, result);
          })
          .catch((err) => {
            log.verbose(LOG_PREFIX, `Whoops: AppleTV failed.`, err);
            return _genResult(action, false, err);
          });
    }

    // Send command to the BedJet server
    if (action.hasOwnProperty('bedJet')) {
      if (!bedJetWSClient) {
        log.error(LOG_PREFIX, 'BedJet unavailable.');
        return _genResult(action, false, 'not_available');
      }
      const strCmd = JSON.stringify(action.bedJet);
      return bedJetWSClient.send(strCmd).then(() => {
        return _genResult(action, true);
      }).catch((err) => {
        return _genResult(action, false, err);
      });
    }

    // Default Temperature
    if (action.hasOwnProperty('defaultTemperature')) {
      if (!googDeviceAccess) {
        log.error(LOG_PREFIX, 'Google Device Access unavailable.');
        return _genResult(action, false, 'not_available');
      }
      if (_config.hvac?.defaultMode === 'OFF') {
        log.debug(LOG_PREFIX, `defaultTemperature skipped, mode is OFF`);
        return _genResult(action, false, 'mode_is_off');
      }
      const value = action.defaultTemperature;
      const settings = _config.hvac?.temperaturePresets?.[value];
      if (!settings) {
        const msg = 'Unable to find specified temperature preset';
        log.warn(LOG_PREFIX, msg, value);
        return _genResult(action, false, 'invalid_temperature_preset');
      }
      return _setDefaultTemperature(settings)
          .then((result) => {
            return _genResult(action, true, result);
          })
          .catch((err) => {
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

    // Google Device Access
    if (action.hasOwnProperty('googDevice')) {
      if (!googDeviceAccess) {
        log.error(LOG_PREFIX, 'Google Device Access unavailable', action);
        return _genResult(action, false, 'not_available');
      }

      return googDeviceAccess.executeCommand(action.googDevice)
          .then((result) => {
            return _genResult(action, true, result);
          })
          .catch((err) => {
            log.verbose(LOG_PREFIX, `Whoops: googDev command failed.`, err);
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

    // Hue Sync
    if (action.hasOwnProperty('hueSync')) {
      if (!hueSync || !hueSync.isReady()) {
        log.error(LOG_PREFIX, 'HueSync unavailable', action);
        return _genResult(action, false, 'not_available');
      }

      return hueSync.executeCommand(action.hueSync)
          .then((result) => {
            return _genResult(action, true, result);
          })
          .catch((err) => {
            log.verbose(LOG_PREFIX, `Whoops: hueSync command failed.`, err);
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

    // Sonos - off
    if (action.hasOwnProperty('sonosOff')) {
      return _sonosOff()
          .then(() => {
            _genResult(action, true, {success: true});
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

    // Web UI
    if (action.hasOwnProperty('webUI')) {
      if (!action.webUI.hasOwnProperty('screenOff')) {
        log.warn(LOG_PREFIX, `webUI missing screenOff param`, action.webUI);
        return _genResult(action, false, 'missing_param');
      }
      if (!action.webUI.hasOwnProperty('devices')) {
        log.warn(LOG_PREFIX, `webUI missing devices param`, action.webUI);
        return _genResult(action, false, 'missing_param');
      }
      const turnScreenOff = action.webUI.screenOff;
      const devices = _arrayify(action.webUI.devices);
      _updateWebUI(turnScreenOff, devices);
      return _genResult(action, true);
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

  /**
   * Get System State value using / notation
   * @param {String} path Path to value
   * @return {*} Result of value
   */
  function _getStateValue(path) {
    let result = _self.state;
    const items = path.split('/');
    items.forEach((item) => {
      if (result && result[item]) {
        result = result[item];
        return;
      }
      result = null;
    });
    return result;
  }

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
    return _fbRootRef.child(path).push(value)
        .catch((err) => {
          log.error(LOG_PREFIX, `Unable to push fb value to ${path}`, err);
        });
  }

  /**
   * Set value to Firebase
   *
   * @param {String} path Path to push object to
   * @param {Object} value The value to push
   * @return {any}
   */
  function _fbSet(path, value) {
    if (path.startsWith('state/')) {
      _updateLocalState(path, value);
    }
    if (!_fbRootRef) {
      log.error(LOG_PREFIX, `fbSet failed, no fbRootRef`);
      return;
    }
    return _fbRootRef.child(path).set(value)
        .then(() => {
          const now = Date.now();
          const lastUpdated = {
            lastUpdated: now,
            lastUpdated_: log.formatTime(now),
          };
          return _fbRootRef.child('state/time').update(lastUpdated);
        })
        .then(() => {
          log.verbose(LOG_PREFIX, `Wrote ${path}`, value);
        })
        .catch((err) => {
          log.error(LOG_PREFIX, `Unable to fb value at ${path}`, err);
        });
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
    _fbPush('logs/history/doors', doorLogObj);
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
    if (now - _lastSoundPlayedAt < (12 * 1000) && opts.force !== true) {
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
    const cmd = `mplayer -ao alsa -really-quiet ${file}`;
    return honExec.run(title, cmd, '.', true)
        .catch((err) => {
          log.error(LOG_PREFIX, `Unable to play sound file '${file}'`, err);
        });
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
    _fbPush('logs/history/systemState', stateLog);
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
   *                         - 0-6: days to run, 'X' for on, or '-' to skip.
   *                         - 7: Use be 'T' for Time, or 'S' for Sun event.
   *                         - If (T) Time:
   *                           - 8-12: Time to start 24 hr format, eg 23:30.
   *                           - 13: Must be 'D' (duration).
   *                           - 14+: Number of minutes the duration lasts.
   *                         - If (S) Sun event:
   *                           - 8+: 'RISE' or 'SET'.
   *                           - 11+: Must be 'D' (duration).
   *                           - 14+: Number of minutes the duration lasts.
   *  Examples:
   *   - '---X---T23:30D60': Wednesday at 11:30pm or up to 60 minutes.
   *   - 'XXXXXXXSSETD30': Every day at Sun Set or up to 30 minutes later.
   * @return {boolean}
   */
  function _inRange(range) {
    const RE_RANGE = /^([-X]{7})((T)(\d\d):(\d\d)|(S)(SET|RISE))D(\d+)$/;
    const matched = range.match(RE_RANGE);
    if (!matched || matched.length !== 9) {
      return false;
    }

    const maDay = matched[1];
    const maHour = matched[4];
    const maMinute = matched[5];

    const maSunEvent = matched[7];

    const maDuration = parseInt(matched[8]);

    const now = moment().second(0).millisecond(0);
    const tomorrow = now.clone().hour(0).minute(0).add(1, 'day');

    let mStart;
    if (maSunEvent === 'RISE') {
      const sunrise = _self.state?.weather?.today?.sunriseTime * 1000;
      if (isNaN(sunrise)) {
        log.error(LOG_PREFIX, 'inRange, no sunrise time available', range);
        return false;
      }
      mStart = moment(sunrise).second(0).millisecond(0);
    } else if (maSunEvent === 'SET') {
      const sunset = _self.state?.weather?.today?.sunsetTime * 1000;
      if (isNaN(sunset)) {
        log.error(LOG_PREFIX, 'inRange, no sunset time available', range);
        return false;
      }
      mStart = moment(sunset).second(0).millisecond(0);
    } else {
      mStart = now.clone().hour(maHour).minute(maMinute);
    }

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
  function _scheduleDelayedCommand(action, source) {
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
  async function _initAppleTV() {
    await _fbSet('state/appleTV', false);

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
    appleTV.on('found', (deviceInfo) => {
      _fbSet('state/appleTV/deviceInfo', deviceInfo);
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
    appleTV.on('ready', () => {
      _fbSet('state/appleTV/ready', true);
    });
    appleTV.on('closed', () => {
      _fbSet('state/appleTV/ready', false);
    });
    appleTV.on('power', (state) => {
      _fbSet('state/appleTV/isPoweredOn', state);
    });

    appleTV.connect(credentials);
  }

  /** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** **
   *
   * Alarm Clock API
   *
   ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** **/

  /**
   * Init the Alarm Clock API
   */
  async function _initAlarmClock() {
    await _fbSet('state/alarmClock', false);

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

  /**
    * Init the auto humidifier
    */
  function _initAutoHumidifier() {
    setTimeout(() => {
      log.init(LOG_PREFIX, 'Starting autoHumidifier...');
      _autoHumidifierTick();
    }, 90 * 1000);

    setInterval(() => {
      _autoHumidifierTick();
    }, 2 * 60 * 1000);
  }

  /**
   * AutoHumidifier Tick
   */
  function _autoHumidifierTick() {
    // Only run when at home
    if (_self.state.systemState !== 'HOME') {
      return;
    }
    // Only run if enabled
    if (_config.hvac.autoHumidifier.disabled === true) {
      return;
    }

    // Loop through each room
    _config.hvac.autoHumidifier.rooms.forEach((room) => {
      try {
        const msgBase = `autoHumidifier[${room.name}]`;

        // Get the current humidity
        const path = room.pathToValue;
        const humidity = Math.round(parseFloat(_getStateValue(path)));
        if (Number.isNaN(humidity)) {
          log.warn(LOG_PREFIX, `${msgBase}: Unable to get humidity`, room);
          return;
        }
        const wemoPlug = _self.state.wemo?.[room.wemoId];
        if (!wemoPlug) {
          log.warn(LOG_PREFIX, `${msgBase}: Unable to get plug state.`, room);
          return;
        }
        // Check the current Wemo state
        const currentWemoState = wemoPlug.value == true;

        // Setup the action we'll send
        const action = {};

        // Check the humidity, turn off if it's above...
        if (humidity > parseInt(_config.hvac.autoHumidifier.offAbove)) {
          action.wemo = {on: false};
        }
        // Check the humidity, turn off if it's above...
        if (humidity < parseInt(_config.hvac.autoHumidifier.onBelow)) {
          action.wemo = {on: true};
        }

        // No change to current state
        if (!action.wemo) {
          return;
        }

        // If the Wemo is already in the expected state, no change required.
        if (action.wemo.on === currentWemoState) {
          return;
        }

        // Log details
        const info = {
          currentHumidity: humidity,
          currentWemoState: currentWemoState,
        };
        log.log(LOG_PREFIX, `${msgBase} changed '${action.wemo.on}'`, info);

        // Turn the humidifier on/off
        action.wemo.name = room.wemoName;
        _executeAction(action, 'AutoHumidifier');
      } catch (ex) {
        log.exception(LOG_PREFIX, `Error in autoHumidifierTick`, ex);
      }
    });
  }


  /** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** **
   *
   * Awair API
   *
   ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** **/

  /**
   * Init the Awair API
   */
  async function _initAwair() {
    await _fbSet('state/awair', false);

    if (_config.awair?.disabled === true) {
      log.warn(LOG_PREFIX, 'Awair disabled via config.');
      return;
    }

    awair = new Awair();
    awair.on('sensors_changed', (key, data) => {
      _fbSet(`state/awair/local/${key}`, data);
    });
  }


  /** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** **
   *
   * BedJet API
   *
   ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** **/

  /**
   * Init the BedJet API
   */
  async function _initBedJet() {
    await _fbSet('state/bedJet', false);
    const address = _config.bedJet?.wsAddress;
    if (!address) {
      log.warn(LOG_PREFIX, 'BedJet disabled, no address specified.');
      return;
    }
    if (_config.bedJet?.disabled === true) {
      log.warn(LOG_PREFIX, 'BedJet disabled via config.');
      return;
    }

    bedJetWSClient = new WSClient(address, true, 'bedjet');
    bedJetWSClient.on('connected', (val) => {
      _fbSet(`state/bedJet/connected`, val);
    });
    bedJetWSClient.on('message', (msg) => {
      if (msg.state) {
        _fbSet(`state/bedJet/state`, msg.state);
        return;
      }
      if (msg.ready) {
        log.debug('BEDJET', 'BedJet ready.', msg);
        return;
      }
      if (msg.ready === false) {
        log.error('BEDJET', 'BedJet not ready.');
        return;
      }
      if (msg.log) {
        log.log('BEDJET', `BedJet message: ${msg.log.message}`, msg.log);
        return;
      }
      log.log(LOG_PREFIX, 'Unknown BedJet Message', msg);
    });
    bedJetWSClient.on('shutdown', () => {
      log.log(LOG_PREFIX, 'BedJet shutdown received.');
    });
  }

  /**
   * Shutdown the Bluetooth Services
   */
  function _shutdownBedJet() {
    if (bedJetWSClient) {
      bedJetWSClient.shutdown();
    }
  }

  /** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** **
   *
   * Bluetooth API
   *
   ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** **/

  /**
   * Init the Bluetooth API
   */
  async function _initBluetooth() {
    await _fbSet('state/bluetooth', false);

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
    bluetooth.on('device_found', (info) => {
      _fbSet(`state/bluetooth/devices/${info.uuid}`, info);
    });
    bluetooth.on('device_connected', (uuid) => {
      _fbSet(`state/bluetooth/devices/${uuid}/connected`, true);
    });
    bluetooth.on('device_disconnected', (uuid) => {
      _fbSet(`state/bluetooth/devices/${uuid}/connected`, false);
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

  /**
   * Updates the sunrise time.
   *
   * @param {Number} today Unix time of sunrise today
   * @param {Number} tomorrow Unix time of sunrise tomorrow
   */
  function _updateSunrise(today, tomorrow) {
    const now = Date.now();
    const next = now < today ? today : tomorrow;
    if (next > _self.state.sun.rise) {
      _fbSet('state/sun/rise', next);
      _fbSet('state/sun/rise_', log.formatTime(next));
      // _scheduleSunEvent('SUNRISE', next);
      const when = moment(next).format('h:mma');
      const cfgPath = 'config/HomeOnNode/alarmClock/run_on_sunrise/time';
      _fbSet(cfgPath, when);
      log.log(LOG_PREFIX, `Updated sunrise timer.`, {cfgPath, when});
    }
  }

  /**
   * Updates the sunset time.
   *
   * @param {Number} today Unix time of sunset today
   * @param {Number} tomorrow Unix time of sunset tomorrow
   */
  function _updateSunset(today, tomorrow) {
    const now = Date.now();
    const next = now < today ? today : tomorrow;
    if (next > _self.state.sun.set) {
      _fbSet('state/sun/set', next);
      _fbSet('state/sun/set_', log.formatTime(next));
      // _scheduleSunEvent('SUNSET', next);
      const when = moment(next).format('h:mma');
      const cfgPath = 'config/HomeOnNode/alarmClock/run_on_sunset/time';
      _fbSet(cfgPath, when);
      log.log(LOG_PREFIX, `Updated sunset timer.`, {cfgPath, when});
    }
  }


  /** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** **
   *
   * Google Device Access API
   *
   ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** **/

  /**
   * Init the Google Device Access API
   */
  async function _initGoogDeviceAccess() {
    await _fbSet('state/googleDeviceAccess', false);

    if (_config.googleDeviceAccess.disabled === true) {
      log.warn(LOG_PREFIX, 'Google Device Access disabled via config.');
      return;
    }

    googDeviceAccess = new GoogDeviceAccess();
    googDeviceAccess.on('device_changed', (device) => {
      const now = Date.now();
      device.lastUpdated = now;
      device.lastUpdated_ = log.formatTime(now);
      const path = `${device.typeShort}/${device.id}`;
      _fbSet(`state/googleDeviceAccess/${path}`, device);
    });
    googDeviceAccess.on('structure_changed', (struct) => {
      _fbSet('state/googleDeviceAccess/structure', struct);
    });
  }

  /**
   * Set the temperature based on the predefined values.
   *
   * @param {Object} settings Settings {key: value}
   */
  async function _setDefaultTemperature(settings) {
    const results = [];
    const devices = Object.keys(settings);
    for await (const deviceName of devices) {
      const tempVal = settings[deviceName];
      const msg = `setDefaultTemperature('${deviceName}', ${tempVal})`;
      const cmd = {
        action: 'setTemperature',
        deviceName: deviceName,
        value: tempVal,
      };
      log.verbose(LOG_PREFIX, msg, cmd);
      try {
        const result = await googDeviceAccess.executeCommand(cmd);
        results.push(result);
      } catch (ex) {
        log.error(LOG_PREFIX, `${msg} - failed`, ex);
      }
    }
    return results;
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
    await _fbSet('state/hue', false);

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

    hue = new Hue(apiKey, hueIP);
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
      log.todo(LOG_PREFIX, 'Hue Sensor Unreach');
      _fbPush('logs/history/messages', msg);
    });
    hue.on('sensor_low_battery', (sensor) => {
      const msg = {
        message: 'Hue sensor low battery',
        level: 5,
        date: Date.now(),
        extra: sensor,
      };
      log.todo(LOG_PREFIX, 'Hue Low Batt');
      _fbPush('logs/history/messages', msg);
    });
    hue.connect(true);
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
   * Philips Hue Sync API
   *
   ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** **/

  /**
   * Init Hue Sync
   */
  async function _initHueSync() {
    await _fbSet('state/hueSync', false);

    if (!_config.hueSync || _config.hueSync.disabled === true) {
      log.warn(LOG_PREFIX, 'HueSync disabled via config.');
      return;
    }

    const ipAddress = _config.hueSync.ipAddress;
    const token = _config.hueSync.token;

    if (!ipAddress || !token) {
      log.error(LOG_PREFIX, `HueSync unavailable, no IP or token available.`);
      return;
    }

    hueSync = new HueSync(ipAddress, token);
    hueSync.on('config_changed', (config) => {
      _fbSet('state/hueSync', config);
    });
    hueSync.connect(true);
  }


  /** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** **
   *
   * LG TV API
   *
   ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** **/

  /**
   * Init the LG TV API
   */
  async function _initLGTV() {
    await _fbSet('state/lgTV', false);

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

    lgTV.connect();
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
    await _fbSet('state/nanoLeaf', false);

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

    nanoLeaf.connect();
  }


  /** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** **
   *
   * Notification System API
   *
   ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** **/

  /**
   * Initialize the Notification System
   */
  function _initNotifications() {
    FBHelper.getRootRefUnlimited()
        .then((fbRootRef) => {
          return fbRootRef.child('state/hasNotifications');
        })
        .then((child) => {
          child.on('value', (snapshot) => {
            if (snapshot.val()) {
              _self.executeCommandByName('NEW_NOTIFICATION', 'HOME');
              log.log(LOG_PREFIX, 'New notification received.');
            }
            return snapshot.ref.set(false);
          });
        })
        .catch((err) => {
          log.error(LOG_PREFIX, 'Error in initNotifications.', err);
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
    await _fbSet('state/presence/state', 'NONE');

    if (!bluetooth) {
      log.warn(LOG_PREFIX, 'Presence disabled, no bluetooth available.');
      return;
    }

    presence = new Presence(bluetooth, _config.presence);
    presence.on('change', _presenceChanged);
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
    const presenceState = numPresent === 0 ? 'NONE' : 'SOME';
    _fbPush('logs/history/presence', presenceLog);
    _fbSet('state/presence/people', who);
    _fbSet('state/presence/state', presenceState);
    _self.executeCommandByName(`PRESENCE_${presenceState}`, 'PRESENCE');
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

    sonos = new Sonos();

    sonos.on('player-state', (playerState) => {
      playerState = JSON.parse(JSON.stringify(playerState));
      _fbSet('state/sonos/state', playerState);
    });

    sonos.on('services-changed', (services) => {
      services = JSON.parse(JSON.stringify(services));
      log.debug(LOG_PREFIX, 'Sonos services changed', services);
      _fbSet('state/sonos/services', services);
    });

    sonos.on('favorites-changed', (favorites) => {
      favorites = JSON.parse(JSON.stringify(favorites));
      _fbSet('state/sonos/favorites', favorites);
    });

    sonos.on('transport-state', (state) => {
      try {
        state = JSON.parse(JSON.stringify(state));
        _fbSet('state/sonos/transportState', state);
      } catch (ex) {
        log.debug(LOG_PREFIX, 'Unable to save Sonos transport state', ex);
      }
    });

    sonos.on('source-changed', (val) => {
      if (typeof val !== 'string') {
        return;
      }
      // TV: "x-sonos-htastream:RINCON_48A6B8B7A4B101400:spdif"
      // WNYC: "x-rincon-stream:RINCON_5CAAFD0C01DC01400"
      // Music Queue: "x-rincon-queue:RINCON_48A6B8B7A4B101400#0"
      // AirPlay: "x-sonos-vli:RINCON_48A6B8B7A4B101400:1,airplay:..."
      // Spotify: "x-sonos-vli:RINCON_48A6B8B7A4B101400:2,spotify:..."
      // Spotify: "x-sonosapi-radio:spotify%3aartistRadio%..."
      const cmdNameBase = `SONOS_SOURCE`;
      let cmdName = null;
      if (val.startsWith('x-sonos-htastream')) {
        cmdName = `${cmdNameBase}_TV`;
      } else if (val.startsWith('x-rincon-stream')) {
        cmdName = `${cmdNameBase}_RADIO`;
      } else if (val.startsWith('x-rincon-queue')) {
        cmdName = `${cmdNameBase}_MUSIC`;
      } else if (val.startsWith('x-sonos-vli')) {
        cmdName = `${cmdNameBase}_MUSIC`;
      } else if (val.startsWith('x-sonosapi-radio')) {
        cmdName = `${cmdNameBase}_MUSIC`;
      } else {
        log.warn(LOG_PREFIX, 'Unknown Sonos source input (assume music)', val);
        cmdName = `${cmdNameBase}_MUSIC`;
      }
      if (cmdName && _config.commands[cmdName]) {
        _self.executeCommandByName(cmdName, 'SONOS');
      }
      _fbSet(`state/sonos/source`, val);
    });

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

    sonos.connect();
  }

  /**
   * Updates the Firebase state to indicate Sonos has been stopped.
   *
   * @return {Promise<boolean>}
   */
  function _sonosOff() {
    const uriOff = 'x-hon-off';
    const currentTrack = {uri: uriOff};
    _fbSet('state/sonos/transportState/state/currentTrack', currentTrack);
    _fbSet('state/sonos/transportState/avTransportUri', uriOff);
    return Promise.resolve(true);
  }


  /** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** **
   *
   * Weather API
   *
   ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** **/

  /**
   * Init Weather
   */
  async function _initWeather() {
    await _fbSet('state/weather', false);

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
      try {
        const todayRise = forecast.today.sunriseTime * 1000;
        const tomRise = forecast.tomorrow.sunriseTime * 1000;
        _updateSunrise(todayRise, tomRise);
        const todaySet = forecast.today.sunsetTime * 1000;
        const tomSet = forecast.tomorrow.sunsetTime * 1000;
        _updateSunset(todaySet, tomSet);
      } catch (ex) {
        log.exception(LOG_PREFIX, 'Unable to update sunrise/sunset', ex);
      }
    });
  }

  /** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** **
   *
   * Web UI Update
   *
   ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** **/

  /**
   * Turn the WebUI screen on or off
   * @param {Boolean} screenOff Turn the screen off
   * @param {Array} devices A list of devices to turn off
   */
  function _updateWebUI(screenOff, devices) {
    devices.forEach((deviceName) => {
      const path = `config/WebUI/${deviceName}/screenOff`;
      const msg = `${path}: ${screenOff}`;
      log.verbose(LOG_PREFIX, msg);
      _fbRootRef.child(path).set(screenOff).catch((err) => {
        log.error(LOG_PREFIX, `Unable to set ${msg}`, err);
      });
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
  async function _initWemo() {
    await _fbSet('state/wemo', false);

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

  return _init().then(() => {
    return _self;
  });
}

util.inherits(Home, EventEmitter);

module.exports = Home;
