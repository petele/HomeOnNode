'use strict';

const EventEmitter = require('events').EventEmitter;
const util = require('util');
const exec = require('child_process').exec;

const Hue = require('./Hue');
const Nest = require('./Nest');
const Wemo = require('./Wemo');
const Tivo = require('./Tivo');
const Sonos = require('./Sonos');
const moment = require('moment');
const log = require('./SystemLog2');
const GCMPush = require('./GCMPush');
const Harmony = require('./HarmonyWS');
const Weather = require('./Weather');
const version = require('./version');
const NanoLeaf = require('./NanoLeaf');
const Presence = require('./Presence');
const Bluetooth = require('./Bluetooth');
const PushBullet = require('./PushBullet');
const AlarmClock = require('./AlarmClock');
const GoogleHome = require('./GoogleHome');

const LOG_PREFIX = 'HOME';

/**
 * Home API
 * @constructor
 *
 * @param {Object} initialConfig Default config to start
 * @param {Object} fbRef Firebase object
*/
function Home(initialConfig, fbRef) {
  const _self = this;
  _self.state = {};

  let _config = initialConfig;
  let _fb = fbRef;

  let alarmClock;
  let bluetooth;
  let gcmPush;
  let harmony;
  let hue;
  let googleHome;
  let nanoLeaf;
  let nest;
  let presence;
  let pushBullet;
  let sonos;
  let tivo;
  let weather;
  let wemo;

  let _doorOpenAccounceTimer;
  let _armingTimer;
  let _lastSoundPlayedAt = 0;

/** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** **
 *
 * Public APIs
 *
 ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** **/

  /**
   * Updates the system config.
   *
   * @param {Object} config New config data.
   */
  this.updateConfig = function(config) {
    if (config && config._version >= 2) {
      _config = config;
      log.log(LOG_PREFIX, 'Config updated.');
      return;
    }
    const msg = 'Config not updated, invalid config provided.';
    log.error(LOG_PREFIX, msg, config);
  };

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
      log.debug(LOG_PREFIX, msg, command);
    } else {
      log.log(LOG_PREFIX, msg, command);
    }

    // Execute any actions in the command
    if (command.actions) {
      return _self.executeActions(command.actions, source);
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
        setTimeout(() => {
          delete action.delay;
          results.push(_self.executeActions(action, `${source}*`));
        }, action.delay * 1000);
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
        log.debug(LOG_PREFIX, 'executeActions(...) complete.', r);
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

      return nanoLeaf.executeCommand(action.nanoLeaf)
        .then((result) => {
          return _genResult(action, true, result);
        })
        .catch((err) => {
          log.verbose(LOG_PREFIX, `Whoops: nanoLeaf failed.`, err);
          return _genResult(action, false, err);
        });
    }

    if (action.hasOwnProperty('nestCam')) {
      if (!nest) {
        log.warn(LOG_PREFIX, 'Nest unavailable.');
        return _genResult(action, false, 'not_available');
      }

      return nest.enableCamera(action.nestCam)
        .then((result) => {
          return _genResult(action, true, result);
        })
        .catch((err) => {
          log.verbose(LOG_PREFIX, `Whoops: nestCam failed.`, err);
          return _genResult(action, false, err);
        });
    }

    if (action.hasOwnProperty('nestFan')) {
      if (!nest) {
        log.warn(LOG_PREFIX, 'Nest unavailable.');
        return _genResult(action, false, 'not_available');
      }

      const roomId = action.nestFan.roomId;
      const minutes = action.nestFan.minutes || 60;
      return nest.runFan(roomId, minutes)
        .then((result) => {
          return _genResult(action, true, result);
        })
        .catch((err) => {
          log.verbose(LOG_PREFIX, `Whoops: nestFan failed.`, err);
          return _genResult(action, false, err);
        });
    }

    if (action.hasOwnProperty('nestState')) {
      if (!nest) {
        log.warn(LOG_PREFIX, 'Nest unavailable.');
        return _genResult(action, false, 'not_available');
      }

      if (action.nestState === 'HOME') {
        return nest.setHome()
          .then((result) => {
            return _genResult(action, true, result);
          })
          .catch((err) => {
            log.verbose(LOG_PREFIX, `Whoops: nestState failed.`, err);
            return _genResult(action, false, err);
          });
      }

      if (action.nestState === 'AWAY') {
        return nest.setAway()
          .then((result) => {
            return _genResult(action, true, result);
          })
          .catch((err) => {
            log.verbose(LOG_PREFIX, `Whoops: nestState failed.`, err);
            return _genResult(action, false, err);
          });
      }
      log.warn(LOG_PREFIX, `Invalid nestState: ${action.nestState}`);
      return _genResult(action, false, 'invalid_state');
    }

    if (action.hasOwnProperty('nestThermostat')) {
      if (!nest) {
        log.warn(LOG_PREFIX, 'Nest unavailable.');
        return _genResult(action, false, 'not_available');
      }

      const roomId = action.nestThermostat.roomId;

      if (action.nestThermostat.temperature) {
        const temperature = action.nestThermostat.temperature;
        return nest.setTemperature(roomId, temperature)
          .then((result) => {
            return _genResult(action, true, result);
          })
          .catch((err) => {
            log.verbose(LOG_PREFIX, `Whoops: nestThermostat failed.`, err);
            return _genResult(action, false, err);
          });
      }

      if (action.nestThermostat.adjust) {
        const direction = action.nestThermostat.adjust;
        return nest.adjustTemperature(roomId, direction)
          .then((result) => {
            return _genResult(action, true, result);
          })
          .catch((err) => {
            log.verbose(LOG_PREFIX, `Whoops: nestThermostat failed.`, err);
            return _genResult(action, false, err);
          });
      }

      log.warn(LOG_PREFIX, `Invalid nestThermostat command.`, action);
      return _genResult(action, false, 'invalid_command');
    }

    if (action.hasOwnProperty('nestThermostatAuto')) {
      if (!nest) {
        log.warn(LOG_PREFIX, 'Nest unavailable.');
        return _genResult(action, false, 'not_available');
      }

      const autoMode = action.nestThermostatAuto;
      if (!autoMode) {
        log.warn(LOG_PREFIX, `Nest auto mode '${autoMode}' not found.`);
        return _genResult(action, false, 'auto_mode_not_found');
      }

      const rooms = _config.nest.hvacAuto[autoMode];
      if (!Array.isArray(rooms)) {
        log.warn(LOG_PREFIX, `No rooms provided for nestAutoMode`, action);
        return _genResult(action, false, 'no_rooms_provided');
      }

      const results = [];
      Object.keys(rooms).forEach((roomId) => {
        const temperature = rooms[roomId];
        const result = nest.setTemperature(roomId, temperature)
          .catch((err) => {
            log.verbose(LOG_PREFIX, `Whoops: nestThermostatAuto failed.`, err);
            return _genResult(action, false, err);
          });
        results.push(result);
      });
      return Promise.all(results)
        .then((result) => {
          return _genResult(action, true, result);
        });
    }

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

    if (action.hasOwnProperty('sound')) {
      const soundFile = action.sound.soundFile;
      const opts = action.sound.opts || {};
      return _playSound(soundFile, opts)
        .then((result) => {
          return _genResult(action, true, result);
        })
        .catch((err) => {
          log.verbose(LOG_PREFIX, `Whoops: sound failed.`, err);
          return _genResult(action, false, err);
        });
    }

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

    if (action.hasOwnProperty('wemo')) {
      if (!wemo) {
        log.warn(LOG_PREFIX, 'Wemo unavailable.');
        return _genResult(action, false, 'not_available');
      }
      return wemo.setState(action.wemo.id, action.wemo.on)
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
 * Init
 *
 ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** **/

  /**
   * Initialize the HOME API
   */
  function _init() {
    log.init(LOG_PREFIX, 'Starting...');
    const now = Date.now();
    _self.state = {
      doNotDisturb: false,
      hasNotification: false,
      systemState: 'AWAY',
      time: {
        started: now,
        started_: log.formatTime(now),
        lastUpdated: now,
        lastUpdated_: log.formatTime(now),
      },
      presence: {
        people: {},
        state: 'NONE',
      },
      gitHead: version.head,
    };
    _fb.child('state').once('value', function(snapshot) {
      _self.state = snapshot.val();
    });
    _fbSet('state/doors', false);
    _fbSet('state/time/started', _self.state.time.started);
    _fbSet('state/time/updated', _self.state.time.started);
    _fbSet('state/time/started_', _self.state.time.started_);
    _fbSet('state/time/updated_', _self.state.time.started_);
    _fbSet('state/gitHead', _self.state.gitHead);
    gcmPush = new GCMPush(_fb);
    _initAlarmClock();
    _initBluetooth();
    _initNotifications();
    _initNest();
    _initHue();
    _initNanoLeaf();
    _initSonos();
    _initHarmony();
    _initPresence();
    _initTivo();
    _initPushBullet();
    _initWeather();
    _initWemo();
    _initCron();
    _initGoogleHome();
    setTimeout(function() {
      _self.emit('ready');
      _playSound(_config.readySound);
    }, 750);
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
    let l = Math.max(1, keys.length -1);

    for (let i = 1; i < l; ++i) {
      let key = keys[i];
      currentObj[key] = currentObj[key] || {};
      currentObj = currentObj[key];
    }
    currentObj[keys[l]] = value;
  }

  /**
   * Push value to Firebase
   *
   * @param {String} path Path to push object to.
   * @param {Object} value The value to push.
   */
  function _fbPush(path, value) {
    let fbObj = _fb;
    if (path) {
      fbObj = _fb.child(path);
    }
    try {
      fbObj.push(value, function(err) {
        if (err) {
          log.exception(LOG_PREFIX, 'Unable to push to Firebase. (CB)', err);
        }
      });
      fbSetLastUpdated();
    } catch (ex) {
      const msg = 'Unable to PUSH data to Firebase. (TC)';
      log.exception(LOG_PREFIX, `${msg}: ex`, ex);
      log.error(LOG_PREFIX, `${msg}: data`, {path: path, value: value});
    }
  }

  /**
   * Set value to Firebase
   *
   * @param {String} path Path to push object to
   * @param {Object} value The value to push
   */
  function _fbSet(path, value) {
    if (path.indexOf('state/') === 0) {
      _updateLocalState(path, value);
    }
    let fbObj = _fb;
    if (path) {
      fbObj = _fb.child(path);
    }
    try {
      if (value === null) {
        fbObj.remove();
      } else {
        fbObj.set(value, function(err) {
          if (err) {
            log.exception(LOG_PREFIX, 'Set data failed on path: ' + path, err);
          }
        });
      }
      fbSetLastUpdated();
    } catch (ex) {
      log.exception(LOG_PREFIX, 'Unable to set data on path: ' + path, ex);
    }
  }

  /**
   * Set state last updated.
   */
  function fbSetLastUpdated() {
    const now = Date.now();
    _fb.child('state/time').update({
      lastUpdated: now,
      lastUpdated_: log.formatTime(now),
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
      log.debug(LOG_PREFIX, 'playSound skipped, too soon.');
      return Promise.reject(new Error('too_soon'));
    }
    if (_self.state.doNotDisturb === true && opts.force !== true) {
      log.debug(LOG_PREFIX, 'playSound skipped, do not disturb.');
      return Promise.reject(new Error('do_not_disturb'));
    }
    _lastSoundPlayedAt = now;
    log.debug(LOG_PREFIX, `playSound('${file}', ...)`, opts);
    if (opts.useHome) {
      return _playSoundGoogleHome(file, opts.contentType);
    }
    return _playSoundLocal(file);
  }

  /**
   * Plays a sound through the local speaker
   *
   * @param {String} file The audio file to play
   * @return {Promise} A promise that resolves to the result of the request
   */
  function _playSoundLocal(file) {
    return new Promise(function(resolve, reject) {
      log.verbose(LOG_PREFIX, `playSoundLocal('${file}')`);
      const cmd = `mplayer ${file}`;
      exec(cmd, function(error, stdOut, stdErr) {
        if (error) {
          log.exception(LOG_PREFIX, '_playSoundLocal failed', error);
          reject(error);
          return;
        }
        resolve(stdOut);
      });
    });
  }

  /**
   * Plays a sound through a Google Home Speaker
   *
   * @param {String} url The audio URL to play
   * @param {String} [contentType] default: 'audio/mp3'.
   * @return {Promise} A promise that resolves to the result of the request
   */
  function _playSoundGoogleHome(url, contentType) {
    if (!googleHome) {
      log.error(LOG_PREFIX, 'Unable to play sound, Google Home not available.');
      return _playSoundLocal(url);
    }
    log.verbose(LOG_PREFIX, `_playSoundGoogleHome('${url}')`);
    return googleHome.play(url, contentType);
  }

  /**
   * Uses Google Home to speak
   *
   * @param {String} utterance The words to say
   * @param {Object} opts Options
   * @return {Promise} A promise that resolves to the result of the request
   */
  function _sayThis(utterance, opts) {
    const force = !!opts.force;
    if (!utterance) {
      log.error(LOG_PREFIX, 'sayThis failed, no utterance provided.');
      return Promise.reject(new Error('no_utterance'));
    }
    if (!googleHome) {
      log.error(LOG_PREFIX, 'Unable to speak, Google Home not available.');
      return Promise.reject(new Error('gh_not_available'));
    }
    log.debug(LOG_PREFIX, `sayThis('${utterance}', ${force})`);
    if (_self.state.doNotDisturb === false || force === true) {
      return googleHome.say(utterance);
    }
    return Promise.reject(new Error('do_not_disturb'));
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
    log.verbose(LOG_PREFIX, `Doorbell from ${source}`);
    _self.executeCommandByName('RUN_ON_DOORBELL', source);
    const now = Date.now();
    const details = {
      date: now,
      date_: log.formatTime(now),
    };
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
 * Alarm Clock API
 *
 ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** **/

  /**
   * Init the Alarm Clock API
   */
  function _initAlarmClock() {
    _fbSet('state/alarmClock', false);

    const fbAlarms = _fb.child('config/HomeOnNode/alarmClock');
    alarmClock = new AlarmClock(fbAlarms);

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
 * Bluetooth API
 *
 ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** **/

  /**
   * Init the Bluetooth API
   */
  function _initBluetooth() {
    _fbSet('state/bluetooth', false);

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
    bluetooth.stopScanning();
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
    try {
      const CronJob = require('cron').CronJob;
      const cronSchedule = '0 0,5,10,15,20,25,30,35,40,45,50,55 * * * *';
      new CronJob(cronSchedule, () => {
        _onCronTick();
      }, null, true, 'America/New_York');
    } catch (ex) {
      log.exception(LOG_PREFIX, 'Unable to initialize Cron', ex);
    }
  }

  /**
   * Cron Tick
   */
  function _onCronTick() {
    log.verbose(LOG_PREFIX, 'CRON: tick');
    const now = Date.now();
    const nowPretty = log.formatTime(now);
    const msg = {
      date: now,
      date_: nowPretty,
    };
    if (_self.state.systemState) {
      msg.systemState = _self.state.systemState;
    }
    try {
      if (_self.state.nest) {
        const keys = Object.keys(_self.state.nest.devices.thermostats);
        msg.thermostats = {};
        keys.forEach((k) => {
          const t = _self.state.nest.devices.thermostats[k];
          msg.thermostats[k] = {
            name: t['name'],
            temperature: t['ambient_temperature_f'],
            humidity: t['humidity'],
          };
        });
      }
    } catch (ex) {
      log.exception(LOG_PREFIX, 'CRON: Unable to store Thermostat info', ex);
    }
    try {
      if (_self.state.presence && _self.state.presence.people) {
        const keys = Object.keys(_self.state.presence.people);
        msg.presence = {};
        keys.forEach((k) => {
          msg.presence[k] = _self.state.presence.people[k].state;
        });
      }
    } catch (ex) {
      log.exception(LOG_PREFIX, 'CRON: Unable to store presence info', ex);
    }
    _fbPush('logs/cron', msg);
  }


/** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** **
 *
 * Harmony API
 *
 ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** **/

  /**
   * Init Harmony API
   */
  function _initHarmony() {
    _fbSet('state/harmony', false);
    const ip = _config.harmony.ipAddress;
    if (!ip) {
      log.error(LOG_PREFIX, `Harmony unavailable, no IP address specified.`);
      return;
    }
    harmony = new Harmony(ip);
    harmony.on('hub_info', (data) => {
      _fbSet('state/harmony/info', data);
    });
    harmony.on('activity_changed', (activity) => {
      _fbSet('state/harmony/activity', activity);
      const honCmdName = `HARMONY_${activity.label.toUpperCase()}`;
      if (_config.commands[honCmdName]) {
        _self.executeCommandByName(honCmdName, 'Harmony');
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
  function _initHue() {
    _fbSet('state/hue', false);

    const apiKey = _config.philipsHue.key;
    if (!apiKey) {
      log.error(LOG_PREFIX, `Hue unavailable, no API key available.`);
      return;
    }
    hue = new Hue(apiKey);
    hue.on('config_changed', (config) => {
      _fbSet('state/hue', config);
    });
    hue.on('lights_changed', (lights) => {
      _fbSet('state/hue/lights', lights);
    });
    hue.on('groups_changed', (groups) => {
      _fbSet('state/hue/groups', groups);
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
    let receipe = _config.lightScenes[receipeName];
    if (receipe && receipe.hue) {
      return receipe.hue;
    }
    return null;
  }


/** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** **
 *
 * Google Home API
 *
 ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** **/

  /**
   * Init the Google Home API
   */
  function _initGoogleHome() {
    _fbSet('state/googleHome', false);

    const ghConfig = _config.googleHome;
    if (!ghConfig || !ghConfig.ipAddress) {
      log.error(LOG_PREFIX, `Google Home unavailable, no config`, ghConfig);
      return;
    }

    googleHome = new GoogleHome(ghConfig.ipAddress);
    googleHome.on('device_info_changed', (data) => {
      _fbSet('state/googleHome', data);
    });
  }


/** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** **
 *
 * NanoLeaf API
 *
 ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** **/

  /**
   * Init NanoLeaf
   */
  function _initNanoLeaf() {
    _fbSet('state/nanoLeaf', false);

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
 * Nest API
 *
 ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** **/

  /**
   * Init Nest
   */
  function _initNest() {
    _fbSet('state/nest', false);

    const apiKey = _config.nest.key;
    if (!apiKey) {
      log.error(LOG_PREFIX, `Nest unavailable, no API key available.`);
      return;
    }
    nest = new Nest.Nest(apiKey, _config.nest.thermostats);
    nest.on('change', (data) => {
      _fbSet('state/nest', data);
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
  function _initNotifications() {
    _fb.child('state/hasNotification').on('value', function(snapshot) {
      if (snapshot.val() === true) {
        _self.executeCommandByName('NEW_NOTIFICATION', 'HOME');
        log.log(LOG_PREFIX, 'New notification received.');
        snapshot.ref().set(false);
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
  function _initPresence() {
    _fbSet('state/presence/state', 'NONE');

    presence = new Presence(bluetooth);
    // Set up the presence detection
    presence.on('change', _presenceChanged);
    const fbPresPath = 'config/HomeOnNode/presence';
    _fb.child(fbPresPath).on('child_added', function(snapshot) {
      const uuid = snapshot.key();
      presence.add(uuid, snapshot.val());
    });
    _fb.child(fbPresPath).on('child_removed', function(snapshot) {
      const uuid = snapshot.key();
      presence.remove(uuid);
    });
    _fb.child(fbPresPath).on('child_changed', function(snapshot) {
      const uuid = snapshot.key();
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
  function _initSonos() {
    _fbSet('state/sonos', false);

    sonos = new Sonos();
    sonos.on('player-state', (transportState) => {
      transportState = JSON.parse(JSON.stringify(transportState));
      _fbSet('state/sonos/state', transportState);
    });
    sonos.on('favorites-changed', (favorites) => {
      favorites = JSON.parse(JSON.stringify(favorites));
      _fbSet('state/sonos/favorites', favorites);
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
    const tivoIP = _config.tivo.ip;
    if (!tivoIP) {
      log.warn(LOG_PREFIX, `TiVo unavailable, no IP address specified.`);
      return;
    }
    tivo = new Tivo(tivoIP);
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
    const fbWemoConfigPath = 'config/HomeOnNode/wemoDevices';
    _fb.child(fbWemoConfigPath).on('child_added', (snapshot) => {
      wemo.addDevice(snapshot.val());
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
