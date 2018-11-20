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
const Harmony = require('./Harmony');
const Weather = require('./Weather');
const version = require('./version');
const NanoLeaf = require('./NanoLeaf');
const Presence = require('./Presence');
const Bluetooth = require('./Bluetooth');
const PushBullet = require('./PushBullet');

const LOG_PREFIX = 'HOME';

/**
 * Home API
 * @constructor
 *
 * @param {Object} initialConfig Default config to start
 * @param {Object} fbRef Firebase object
*/
function Home(initialConfig, fbRef) {
  const ALSO_RUN_EXT = 'ALSO_RUN';
  const DELAYED_EXT = 'DELAYED';
  const TIME_RANGE_EXT = 'TIME_RANGE';
  const _self = this;
  _self.state = {};

  let _config = initialConfig;
  let _fb = fbRef;

  let bluetooth;
  let gcmPush;
  let harmony;
  let hue;
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
   * @param {String} modifier Any applied modifier.
   * @param {String} source The source of the command.
   */
  this.executeCommandByName = function(commandName, modifier, source) {
    if (!commandName) {
      log.warn(LOG_PREFIX, 'commandName not provided.');
      return;
    }
    const command = _config.commands[commandName];
    if (!command) {
      log.warn(LOG_PREFIX, `Command ${commandName} not found.`);
      return;
    }
    command.modifier = modifier;
    command.commandName = commandName;
    _self.executeCommand(command, source);
  };

  /**
   * Executes a command.
   *
   * @param {Object} command The command to execute.
   * @param {String} source The source of the command.
   */
  this.executeCommand = function(command, source) {
    const modifier = command.modifier;
    let msg = 'executeCommand';
    if (command.commandName) {
      msg += `ByName('${command.commandName}', `;
    } else {
      msg += `([${Object.keys(command)}], `;
    }
    if (modifier) {
      msg += `'${modifier}', `;
    } else {
      msg += 'null, ';
    }
    msg += `'${source}')`;
    if ((source.indexOf(ALSO_RUN_EXT) >= 0) ||
        (source.indexOf(TIME_RANGE_EXT) >= 0)) {
          log.debug(LOG_PREFIX, msg, command);
    } else {
      log.log(LOG_PREFIX, msg, command);
    }
    // If it's a NoOp, stop here.
    if (command.noop === true) {
      return;
    }
    // Door Open/Close event
    if (command.hasOwnProperty('door')) {
      const doorName = command.door.name;
      const state = command.door.state;
      if (doorName && state) {
        _handleDoorEvent(doorName, state);
      } else {
        log.warn(LOG_PREFIX, `Invalid door params: ${doorName} / ${state}`);
      }
    }
    // systemState
    if (command.hasOwnProperty('state')) {
      _setState(command.state);
    }
    // Hue Scenes
    if (command.hasOwnProperty('hueScene')) {
      if (hue) {
        let scenes = command.hueScene;
        if (Array.isArray(scenes) === false) {
          scenes = [scenes];
        }
        scenes.forEach(function(sceneId) {
          hue.setScene(sceneId);
        });
      } else {
        log.warn(LOG_PREFIX, 'Hue unavailable.');
      }
    }
    // Hue Commands
    if (command.hasOwnProperty('hueCommand')) {
      if (hue) {
        let cmds = command.hueCommand;
        if (Array.isArray(cmds) === false) {
          cmds = [cmds];
        }
        cmds.forEach(function(cmd) {
          let scene;
          if (modifier) {
            scene = _getLightReceipeByName(modifier);
          } else if (cmd.lightState) {
            scene = cmd.lightState;
          } else {
            scene = _getLightReceipeByName(cmd.receipeName);
          }
          hue.setLights(cmd.lights, scene);
        });
      } else {
        log.warn(LOG_PREFIX, 'Hue unavailable.');
      }
    }
    // Doorbell
    if (command.hasOwnProperty('doorbell')) {
      _ringDoorbell(source);
    }
    // TiVo
    if (command.hasOwnProperty('tivo')) {
      if (tivo) {
        let cmds = command.tivo;
        if (Array.isArray(cmds) === false) {
          cmds = [cmds];
        }
        cmds.forEach((cmd) => {
          tivo.send(cmd);
        });
      } else {
        log.warn(LOG_PREFIX, 'TiVo unavailable.');
      }
    }
    // NanoLeaf
    if (command.hasOwnProperty('nanoLeaf')) {
      if (nanoLeaf) {
        let cmds = command.nanoLeaf;
        if (Array.isArray(cmds) === false) {
          cmds = [cmds];
        }
        cmds.forEach((cmd) => {
          nanoLeaf.executeCommand(cmd, modifier);
        });
      } else {
        log.warn(LOG_PREFIX, 'NanoLeaf unavailable.');
      }
    }
    // Nest Home State
    if (command.hasOwnProperty('nestState')) {
      if (nest) {
        if (command.nestState === 'HOME') {
          nest.setHome();
        } else if (command.nestState === 'AWAY') {
          nest.setAway();
        } else {
          log.warn(LOG_PREFIX, `Unknown Nest state: ${command.nestState}`);
        }
      } else {
        log.warn(LOG_PREFIX, 'Nest unavailable.');
      }
    }
    // Nest Thermostat
    if (command.hasOwnProperty('nestThermostat')) {
      if (nest) {
        let cmds = command.nestThermostat;
        if (Array.isArray(cmds) === false) {
          cmds = [cmds];
        }
        cmds.forEach((cmd) => {
          if (modifier) {
            nest.adjustTemperature(cmd.roomId, modifier);
          } else {
            nest.setTemperature(cmd.roomId, cmd.temperature);
          }
        });
      } else {
        log.warn(LOG_PREFIX, 'Nest unavailable.');
      }
    }
    // Nest Thermostat Auto
    if (command.hasOwnProperty('nestThermostatAuto')) {
      if (nest) {
        const autoMode = command.nestThermostatAuto.toUpperCase();
        const temperatures = _config.nest.hvacAuto[autoMode];
        if (temperatures) {
          Object.keys(temperatures).forEach((roomId) => {
            let temperature = temperatures[roomId];
            nest.setTemperature(roomId, temperature);
          });
        } else {
          log.warn(LOG_PREFIX, `Nest auto mode '${autoMode}' not found.`);
        }
      } else {
        log.warn(LOG_PREFIX, 'Nest unavailable.');
      }
    }
    // Nest Fan
    if (command.hasOwnProperty('nestFan')) {
      if (nest) {
        let cmd = command.nestFan;
        nest.runNestFan(cmd.roomId, cmd.minutes);
      } else {
        log.warn(LOG_PREFIX, 'Nest unavailable.');
      }
    }
    // Nest Cam
    if (command.hasOwnProperty('nestCam')) {
      if (nest) {
        let enabled = command.nestCam === 'ON';
        if (modifier === 'OFF') {
          enabled = false;
        }
        nest.enableCamera(enabled);
      } else {
        log.warn(LOG_PREFIX, 'Nest unavailable.');
      }
    }
    // Wemo Command
    if (command.hasOwnProperty('wemo')) {
      if (wemo) {
        let cmds = command.wemo;
        if (!Array.isArray(cmds)) {
          cmds = [cmds];
        }
        cmds.forEach((cmd) => {
          if (modifier === 'OFF') {
            cmd.on = false;
          }
          wemo.setState(cmd.id, cmd.on);
        });
      } else {
        log.warn(LOG_PREFIX, 'Wemo unavailable.');
      }
    }
    // Harmony Activity
    if (command.hasOwnProperty('harmonyActivity')) {
      if (harmony) {
        harmony.setActivityByName(command.harmonyActivity);
      } else {
        log.warn(LOG_PREFIX, 'Harmony unavailable.');
      }
    }
    // Harmony Key
    if (command.hasOwnProperty('harmonyKey')) {
      if (harmony) {
        let cmds = command.harmonyKey;
        if (Array.isArray(cmds) === false) {
          cmds = [cmds];
        }
        cmds.forEach((cmd) => {
          harmony.sendKey(cmd);
        });
      } else {
        log.warn(LOG_PREFIX, 'Harmony unavailable.');
      }
    }
    // Sonos
    if (command.hasOwnProperty('sonos')) {
      if (sonos) {
          sonos.executeCommand(command.sonos, _config.sonosPresetOptions);
      } else {
        log.error('[HOME] Sonos command failed, Sonos unavailable.');
      }
    }
    // Send Notification
    if (command.hasOwnProperty('sendNotification')) {
      if (gcmPush) {
        gcmPush.sendMessage(command.sendNotification);
      } else {
        log.warn(LOG_PREFIX, 'GCMPush unavailable.');
      }
    }
    // Play Sound
    if (command.hasOwnProperty('sound')) {
      _playSound(command.sound, command.soundForce);
    }
    // Say This
    if (command.hasOwnProperty('sayThis')) {
      _sayThis(command.sayThis, command.soundForce);
    }
    // Do Not Disturb
    if (command.hasOwnProperty('doNotDisturb')) {
      if (modifier === 'OFF' || command.doNotDisturb === 'OFF') {
        _setDoNotDisturb('OFF');
      } else {
        _setDoNotDisturb('ON');
      }
    }
    // Schedule a delayed command
    if (command.hasOwnProperty('delay')) {
      let cmds = command.delay;
      if (Array.isArray(cmds) === false) {
        cmds = [cmds];
      }
      const src = `${source}-${DELAYED_EXT}`;
      cmds.forEach((cmd) => {
        if (!cmd) {
          return;
        }
        const delay = cmd.delayMS || 30 * 1000;
        setTimeout(() => {
          if (cmd.hasOwnProperty('cmdName')) {
            _self.executeCommandByName(cmd.cmdName, cmd.modifier, src);
          } else {
            _self.executeCommand(cmd.command, src);
          }
        }, delay);
        const msg = `Scheduled command to run in ${delay / 1000}s`;
        log.debug(LOG_PREFIX, msg, cmd);
      });
    }
    // Run other cmdNames
    if (command.hasOwnProperty('alsoRun')) {
      let cmds = command.alsoRun;
      if (Array.isArray(cmds) === false) {
        cmds = [cmds];
      }
      const src = `${source}-${ALSO_RUN_EXT}`;
      cmds.forEach((cmd) => {
        if (!cmd) {
          return;
        }
        if (cmd.hasOwnProperty('cmdName')) {
          _self.executeCommandByName(cmd.cmdName, cmd.modifier, src);
        } else {
          _self.executeCommand(cmd.command, src);
        }
      });
    }
    // Only run on time range
    if (command.hasOwnProperty('runBetween')) {
      let cmds = command.runBetween;
      if (Array.isArray(cmds) === false) {
        cmds = [cmds];
      }
      const src = `${source}-${TIME_RANGE_EXT}`;
      cmds.forEach((cmd) => {
        if (!cmd) {
          return;
        }
        if (_inRange(cmd.range)) {
          if (cmd.hasOwnProperty('cmdName')) {
            _self.executeCommandByName(cmd.cmdName, cmd.modifier, src);
          } else {
            _self.executeCommand(cmd.command, src);
          }
        } else {
          const msg = `Command not run, not in time range: ${cmd.range}`;
          log.debug(LOG_PREFIX, msg, cmd);
        }
      });
    }
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
 * Init
 *
 ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** **/

  /**
   * Initialize the HOME Api
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
      gitHead: version.head,
    };
    _fb.child('state').once('value', function(snapshot) {
      _self.state = snapshot.val();
    });
    _fbSet('state/time/started', _self.state.time.started);
    _fbSet('state/time/updated', _self.state.time.started);
    _fbSet('state/time/started_', _self.state.time.started_);
    _fbSet('state/time/updated_', _self.state.time.started_);
    _fbSet('state/gitHead', _self.state.gitHead);
    gcmPush = new GCMPush(_fb);
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
   * @param {String} path The path to set
   * @param {Object} value The value to set
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
   * @param {String} path Path to push object to
   * @param {Object} value The value to push
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
      log.exception(LOG_PREFIX, 'Unable to PUSH data to Firebase. (TC)', ex);
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
   * Set state last updated
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
   * Handles a door open/close event
   *
   * @param {String} doorName Name of the door, ie front
   * @param {String} doorState Door state (OPEN/CLOSED)
   */
  function _handleDoorEvent(doorName, doorState) {
    try {
      if (_self.state.doors[doorName] === doorState) {
        log.info(LOG_PREFIX, 'Door debouncer, door already ' + doorState);
        return;
      }
    } catch (ex) {
      // NoOp - if the door wasn't set before, it will be now.
    }
    _fbSet(`state/doors/${doorName}`, doorState);
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
    log.log(LOG_PREFIX, msg);
    if (_self.state.systemState === 'AWAY' && doorState === 'OPEN') {
      _setState('HOME');
      _announceDoorOpened(doorName);
    }
    // const cmdName = 'DOOR_' + doorName;
    // let modifier;
    // if (doorState === 'CLOSED') {
    //   modifier = 'OFF';
    // }
    // _self.executeCommandByName(cmdName, modifier, cmdName);
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
    log.debug(LOG_PREFIX, `_doorOpenAccounceTimer('${doorName}')`);
    const presenceAlarmTimeout = _config.presenceAlarm.timeout;
    _doorOpenAccounceTimer = setTimeout(() => {
      _doorOpenAccounceTimer = null;
      let isSomeonePresent = false;
      Object.keys(_self.state.presence).forEach((k) => {
        const person = _self.state.presence[k];
        if (person.track && person.state === 'PRESENT') {
          isSomeonePresent = true;
        }
      });
      if (isSomeonePresent === false) {
        log.warn(LOG_PREFIX, `${doorName} opened, but no one was present.`);
        const cmdName = _config.presenceAlarm.cmdName;
        if (cmdName) {
          const cmd = _config.commands[cmdName];
          _self.executeCommand(cmd, 'doorAlarm');
        }
      } else {
        log.debug(LOG_PREFIX, `${doorName} opened, someone was present.`);
      }
    }, presenceAlarmTimeout);
  }


  /**
   * Plays a sound
   *
   * @param {String} file The audio file to play
   * @param {Boolean} force Override doNotDisturb settings
   * @return {Promise} A promise that resolves to the result of the request
   */
  function _playSound(file, force) {
    return new Promise(function(resolve, reject) {
      const now = Date.now();
      if (now - _lastSoundPlayedAt < (20 * 1000) && force !== true) {
        log.debug(LOG_PREFIX, 'playSound skipped, too soon.');
        resolve({playSound: false, reason: 'too_soon'});
        return;
      }
      if (_self.state.doNotDisturb === true && force !== true) {
        log.debug(LOG_PREFIX, 'playSound skipped, do not disturb.');
        resolve({playSound: false, reason: 'do_not_disturb'});
        return;
      }
      _lastSoundPlayedAt = now;
      log.debug(LOG_PREFIX, `playSound('${file}', ${force})`);
      const cmd = `mplayer ${file}`;
      exec(cmd, function(error, stdout, stderr) {
        if (error) {
          log.exception(LOG_PREFIX, 'PlaySound Error', error);
          resolve({playSound: false, reason: 'error', error: error});
          return;
        }
        resolve({playSound: true});
      });
    });
  }

  /**
   * Adds an Utterance to the Firebase queue
   *
   * @param {String} utterance The words to say
   * @param {Boolean} force Override doNotDisturb settings
   * @return {Promise} A promise that resolves to the result of the request
   */
  function _sayThis(utterance, force) {
    return new Promise(function(resolve, reject) {
      log.debug(LOG_PREFIX, `sayThis('${utterance}', ${force})`);
      if (_self.state.doNotDisturb === false || force === true) {
        const sayObj = {
          sayAt: Date.now(),
          utterance: utterance,
        };
        _fbPush('sayThis', sayObj);
        resolve({sayThis: true});
        return;
      }
      resolve({sayThis: false, reason: 'do_not_disturb'});
    });
  }

  /**
   * Sets the Do Not Disturb property
   *
   * @param {String} val Turn do not disturb on/off
   * @return {Promise} A promise that resolves to the result of the request
   */
  function _setDoNotDisturb(val) {
    log.log(LOG_PREFIX, `setDoNotDisturb('${val}')`);
    const doNotDisturb = val === 'ON' ? true : false;
    _fbSet('state/doNotDisturb', doNotDisturb);
    return Promise.resolve({doNotDisturb: doNotDisturb});
  }

  /**
   * Ring the doorbell
   *
   * @param {String} source Where doorbell was rung/sender
   */
  function _ringDoorbell(source) {
    log.log(LOG_PREFIX, `Doorbell from ${source}`);
    _self.executeCommandByName('RUN_ON_DOORBELL', null, source);
    const now = Date.now();
    _fbSet('state/lastDoorbell', now);
  }

  /**
   * Change the system state (HOME/AWAY/ARMED)
   *
   * @param {String} newState The new state to set the house to
   * @return {Promise} A promise that resolves to the result of the request
   */
  function _setState(newState) {
    if (_self.state.systemState === newState) {
      log.warn(LOG_PREFIX, 'State already set to ' + newState);
      return Promise.resolve({state: newState});
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
    // Update the Nest state
    if (nest) {
      if (newState === 'AWAY' || newState === 'ARMED') {
        nest.setAway();
      } else {
        nest.setHome();
      }
    }
    const now = Date.now();
    const stateLog = {
      level: 'INFO',
      message: newState,
      state: newState,
      date: now,
      date_: log.formatTime(now),
    };
    _fbPush('logs/systemState', stateLog);
    _self.executeCommandByName('RUN_ON_' + newState, null, 'SET_STATE');
    return Promise.resolve({state: newState});
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
 * Bluetooth API
 *
 ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** ** **/

  /**
   * Init the Bluetooth API
   */
  function _initBluetooth() {
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
    log.debug(LOG_PREFIX, 'CRON: tick');
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
      if (_self.state.presence) {
        const keys = Object.keys(_self.state.presence);
        msg.presence = {};
        keys.forEach((k) => {
          msg.presence[k] = _self.state.presence[k].state;
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
    const apiKey = _config.harmony.key;
    if (!apiKey) {
      log.error(LOG_PREFIX, `Harmony unavailable, no API key available.`);
      return;
    }
    harmony = new Harmony(apiKey);
    harmony.on('activity_changed', (activity) => {
      _fbSet('state/harmony', activity);
      const honCmdName = `HARMONY_${activity.label.toUpperCase()}`;
      const honCmd = _config.commands[honCmdName];
      if (honCmd) {
        _self.executeCommand(honCmd, 'Harmony');
      }
    });
    harmony.on('config_changed', (config) => {
      _fbSet('state/harmonyConfig', config);
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
    log.error(LOG_PREFIX, `Unable to retreive receipe: ${receipeName}`);
    return {bri: 254, ct: 369, on: true};
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
    const apiKey = _config.nest.key;
    if (!apiKey) {
      log.error(LOG_PREFIX, `Nest unavailable, no API key available.`);
      return;
    }
    nest = new Nest.Nest(apiKey, _config.nest.thermostats);
    nest.on('change', (data) => {
      _fbSet('state/nest', data);
      _self.state.nest = data;
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
        if (_self.state.systemState === 'HOME') {
          _self.executeCommandByName('NEW_NOTIFICATION', null, 'HOME');
        }
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
    _fbSet('state/presence', who);
    _self.state.presence = who;
    let cmdName = 'PRESENCE_SOME';
    if (numPresent === 0) {
      cmdName = 'PRESENCE_NONE';
    } else {
      if (_self.state.systemState === 'AWAY') {
        _setState('HOME');
      }
    }
    _self.executeCommandByName(cmdName, null, 'PRESENCE');
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
    if (_self.state.systemState !== 'HOME') {
      return;
    }
    const msgAppName = msg.application_name;
    if (!msgAppName) {
      return;
    }
    const cmdName = _config.pushBullet.notificationTypes[msgAppName];
    if (cmdName) {
      _self.executeCommandByName(cmdName, null, 'PushBullet');
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
      log.warn(LOG_PREFIX, `Tivo unavailable, no IP address specified.`);
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
    wemo = new Wemo();
    wemo.on('device_found', (id, data) => {
      _fbSet(`state/wemo/${id}`, data);
    });
    wemo.on('change', (id, data) => {
      _fbSet(`state/wemo/${id}`, data);
    });
    wemo.on('error', (err) => {
      log.debug(LOG_PREFIX, `Ignored Wemo error`, err);
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
