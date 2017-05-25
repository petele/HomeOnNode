'use strict';

const EventEmitter = require('events').EventEmitter;
const util = require('util');
const exec = require('child_process').exec;
const log = require('./SystemLog2');
const Keys = require('./Keys').keys;
const version = require('./version');
const moment = require('moment');
const fs = require('fs');


var Hue = require('./Hue');
var ZWave = require('./ZWave');
const Presence = require('./Presence');
const PushBullet = require('./PushBullet');
const Harmony = require('./Harmony');
const Nest = require('./Nest');
const Sonos = require('./Sonos');
const GCMPush = require('./GCMPush');
const NanoLeaf = require('./NanoLeaf');
const Weather = require('./Weather');

const LOG_PREFIX = 'HOME';

function Home(config, fb) {
  this.state = {};
  const _self = this;

  var hue;
  var zwave;
  let presence;
  let pushBullet;
  let harmony;
  let nest;
  let sonos;
  let gcmPush;
  let nanoLeaf;
  let weather;

  var armingTimer;
  var zwaveTimer;
  let _lastSoundPlayedAt = 0;

  /*****************************************************************************
   *
   * Primary commands
   *
   ****************************************************************************/

  function getLightSceneByName(sceneName) {
    const defaultScene = {bri: 254, ct: 369, on: true};
    sceneName = sceneName.toString();
    if (sceneName) {
      try {
        sceneName = sceneName.toUpperCase();
        const result = config.lightScenes[sceneName];
        if (result.hue) {
          return result.hue;
        }
      } catch (ex) {
        log.error(LOG_PREFIX, 'Error retreiving light scene: ' + sceneName);
        return defaultScene;
      }
    }
    log.warn(LOG_PREFIX, 'Could not determine light scene: ' + sceneName);
    return defaultScene;
  }

  this.handleKeyEntry = function(key, modifier, sender) {
    try {
      const cmdName = config.keypad.keys[key];
      if (cmdName) {
        _self.executeCommandByName(cmdName, modifier, sender);
      } else {
        log.warn(LOG_PREFIX, 'Unknown key pressed: ' + key);
      }
    } catch (ex) {
      log.exception(LOG_PREFIX, 'Error handling key entry.', ex);
    }
  };

  this.executeCommandByName = function(commandName, modifier, source) {
    let command = config.commands[commandName];
    if (command) {
      command.modifier = modifier;
      _self.executeCommand(command, source);
      return;
    }
    log.warn(LOG_PREFIX, 'Command (' + commandName + ') not found.');
  };

  this.executeCommand = function(command, source) {
    let cmds;
    const modifier = command.modifier;
    let msg = 'executeCommand ';
    msg += '[' + Object.keys(command) + ']';
    if (modifier) {
      msg += ' (' + modifier + ')';
    }
    msg += ' received from: ' + source;
    log.log(LOG_PREFIX, msg, command);

    // DONE
    if (command.hasOwnProperty('state')) {
      _setState(command.state);
    }

    // TODO
    if (command.hasOwnProperty('hueScene')) {
      let scenes = command.hueScene;
      if (Array.isArray(scenes) === false) {
        scenes = [scenes];
      }
      scenes.forEach(function(scene) {
        setHueScene(scene);
      });
    }

    // TODO
    if (command.hasOwnProperty('hueCommand')) {
      cmds = command.hueCommand;
      if (Array.isArray(cmds) === false) {
        cmds = [cmds];
      }
      cmds.forEach(function(cmd) {
        let scene;
        if (modifier) {
          scene = getLightSceneByName(modifier);
        } else if (cmd.lightState) {
          scene = cmd.lightState;
        } else {
          scene = getLightSceneByName(cmd.receipeName);
        }
        setHueLights(cmd.lights, scene);
      });
    }

    // DONE
    if (command.hasOwnProperty('nanoLeaf')) {
      if (nanoLeaf) {
        nanoLeaf.executeCommand(command.nanoLeaf, modifier);
      } else {
        log.warn(LOG_PREFIX, 'NanoLeaf unavailable.');
      }
    }

    // DONE
    if (command.hasOwnProperty('nestThermostat')) {
      if (nest) {
        let cmd = command.nestThermostat;
        if (modifier) {
          nest.adjustTemperature(cmd.roomId, modifier);
        } else {
          nest.setTemperature(cmd.roomId, cmd.temperature);
        }
      } else {
        log.warn(LOG_PREFIX, 'Nest unavailable.');
      }
    }

    // DONE
    if (command.hasOwnProperty('nestThermostatAuto')) {
      if (nest) {
        nest.setAutoTemperature(command.nestThermostatAuto);
      } else {
        log.warn(LOG_PREFIX, 'Nest unavailable.');
      }
    }

    // DONE
    if (command.hasOwnProperty('nestFan')) {
      if (nest) {
        let cmd = command.nestFan;
        nest.runNestFan(cmd.roomId, cmd.minutes);
      } else {
        log.warn(LOG_PREFIX, 'Nest unavailable.');
      }
    }

    // DONE
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

    // DONE
    if (command.hasOwnProperty('harmonyActivity')) {
      if (harmony) {
        harmony.setActivityByName(command.harmonyActivity);
      } else {
        log.warn(LOG_PREFIX, 'Harmony unavailable.');
      }
    }

    // DONE
    if (command.hasOwnProperty('harmonyKey')) {
      log.warn(LOG_PREFIX, 'DEPRECATED: harmonyKey');
    }

    // DONE
    if (command.hasOwnProperty('sonos')) {
      if (sonos) {
          sonos.executeCommand(command.sonos, config.sonosPresetOptions);
      } else {
        log.error('[HOME] Sonos command failed, Sonos unavailable.');
      }
    }

    // DONE
    if (command.hasOwnProperty('sendNotification')) {
      if (gcmPush) {
        gcmPush.sendMessage(command.sendNotification);
      } else {
        log.warn(LOG_PREFIX, 'GCMPush unavailable.');
      }
    }

    // DONE
    if (command.hasOwnProperty('sound')) {
      _playSound(command.sound, command.soundForce);
    }

    // DONE
    if (command.hasOwnProperty('sayThis')) {
      _sayThis(command.sayThis, command.soundForce);
    }

    // DONE
    if (command.hasOwnProperty('doNotDisturb')) {
      if (modifier === 'OFF' || command.doNotDisturb === 'OFF') {
        _setDoNotDisturb('OFF');
      } else {
        _setDoNotDisturb('ON');
      }
    }
  };

  /**
   * Ring the doorbell
   *
   * @param {String} source Where doorbell was rung/sender
  */
  this.ringDoorbell = function(source) {
    log.log(LOG_PREFIX, 'Doorbell');
    fbSet('state/lastDoorbell', Date.now());
    _self.executeCommandByName('RUN_ON_DOORBELL', null, source);
  };


  function handleDoorEvent(doorName, doorState, updateState) {
    try {
      if (_self.state.doors[doorName] === doorState) {
        log.info(LOG_PREFIX, 'Door debouncer, door already ' + doorState);
        return;
      }
    } catch (ex) {
      // NoOp - if the door wasn't set before, it will be now.
    }
    fbSet('state/doors/' + doorName, doorState);
    const now = Date.now();
    const doorLogObj = {
      level: 'INFO',
      message: doorName + ' door ' + doorState,
      doorName: doorName,
      state: doorState,
      date: now,
      date_: moment(now).format('YYYY-MM-DDTHH:mm:ss.SSS'),
    };
    fbPush('logs/doors', doorLogObj);
    log.log(LOG_PREFIX, doorName + ' ' + doorState);
    if (updateState === true) {
      if (_self.state.systemState === 'AWAY' && doorState === 'OPEN') {
        _setState('HOME');
      }
    }
    const cmdName = 'DOOR_' + doorName;
    let modifier;
    if (doorState === 'CLOSED') {
      modifier = 'OFF';
    }
    return _self.executeCommandByName(cmdName, modifier, 'DOOR_' + doorName);
  }

  /**
   * Sets the Do Not Disturb property
   *
   * @param {String} val Turn do not disturb on/off
  */
  function _setDoNotDisturb(val) {
    log.debug(LOG_PREFIX, 'setDoNotDisturb: ' + val);
    if (val === 'ON') {
      fbSet('state/doNotDisturb', true);
      return;
    }
    fbSet('state/doNotDisturb', false);
  }

  function _setState(newState) {
    log.debug(LOG_PREFIX, 'setState: ' + newState);
    if (armingTimer) {
      clearTimeout(armingTimer);
      armingTimer = null;
    }
    const armingDelay = config.armingDelay || 90000;
    if (newState === 'ARMED') {
      armingTimer = setTimeout(function() {
        armingTimer = null;
        _setState('AWAY');
      }, armingDelay);
    }
    if (_self.state.systemState === newState) {
      log.warn(LOG_PREFIX, 'State already set to ' + newState);
      return false;
    }
    fbSet('state/systemState', newState);
    const now = Date.now();
    const stateLog = {
      level: 'INFO',
      message: newState,
      state: newState,
      date: now,
      date_: moment(now).format('YYYY-MM-DDTHH:mm:ss.SSS'),
    };
    fbPush('logs/systemState', stateLog);
    if (nest) {
      if (newState === 'AWAY' || newState === 'ARMED') {
        nest.setAway();
      } else {
        nest.setHome();
      }
    }
    _self.executeCommandByName('RUN_ON_' + newState, null, 'SET_STATE');
    return true;
  }

  /**
   * Plays a sound
   *
   * @param {String} file The audio file to play
   * @param {Boolean} force Override doNotDisturb settings
  */
  function _playSound(file, force) {
    const now = Date.now();
    if (force === true) {
      _lastSoundPlayedAt = 0;
    }
    if (now - _lastSoundPlayedAt < (20 * 1000)) {
      log.debug(LOG_PREFIX, 'playSound skipped, too soon.');
      return;
    }
    _lastSoundPlayedAt = now;
    log.debug(LOG_PREFIX, `playSound: ${file} ${force}`);
    if (_self.state.doNotDisturb === false || force === true) {
      const cmd = `mplayer ${file}`;
      exec(cmd, function(error, stdout, stderr) {
        if (error) {
          log.exception(LOG_PREFIX, 'PlaySound Error', error);
        }
      });
    }
  }

  /**
   * Adds an Utterance to the Firebase queue
   *
   * @param {String} utterance The words to say
   * @param {Boolean} force Override doNotDisturb settings
  */
  function _sayThis(utterance, force) {
    log.debug(LOG_PREFIX, 'sayThis: ' + utterance + ' ' + force);
    if (_self.state.doNotDisturb === false || force === true) {
      const sayObj = {
        sayAt: Date.now(),
        utterance: utterance,
      };
      fbPush('sayThis', sayObj);
    }
  }

  /*****************************************************************************
   *
   * Firebase & Log Helpers
   *
   ****************************************************************************/

  /**
   * Push value to Firebase
   *
   * @param {String} path Path to push object to
   * @param {Object} value The value to push
  */
  function fbPush(path, value) {
    let fbObj = fb;
    if (path) {
      fbObj = fb.child(path);
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
  function fbSet(path, value) {
    let fbObj = fb;
    if (path) {
      fbObj = fb.child(path);
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
    fb.child('state/time').update({
      lastUpdated: now,
      lastUpdated_: moment(now).format('YYYY-MM-DDTHH:mm:ss.SSS'),
    });
  }

  /**
   * Init Weather
  */
  function _initWeather() {
    weather = new Weather(config.weatherLatLong, Keys.forecastIO.key);
    weather.on('weather', (forecast) => {
      fbSet('state/weather', forecast);
    });
  }

  /**
   * Init Presence
  */
  function _initPresence() {
    presence = new Presence();
    const fbPresFlicPath = 'config/HomeOnNode/presence/FlicAway';
    fb.child(fbPresFlicPath).on('value', function(snapshot) {
      presence.setFlicAwayUUID(snapshot.val());
    });
    presence.on('flic_away', () => {
      _self.executeCommand({state: 'ARMED'}, 'Flic');
    });
    presence.on('change', _presenceChanged);
    const fbPresPath = 'config/HomeOnNode/presence/people';
    fb.child(fbPresPath).on('child_added', function(snapshot) {
      presence.addPerson(snapshot.val());
    });
    fb.child(fbPresPath).on('child_removed', function(snapshot) {
      const uuid = snapshot.val().uuid;
      presence.removePersonByKey(uuid);
    });
    fb.child(fbPresPath).on('child_changed', function(snapshot) {
      presence.updatePerson(snapshot.val());
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
      date_: person.lastSeen_,
    };
    fbPush('logs/presence', presenceLog);
    fbSet('state/presence', who);
    let cmdName = 'PRESENCE_SOME';
    if (numPresent === 0) {
      cmdName = 'PRESENCE_NONE';
    }
    _self.executeCommandByName(cmdName, null, 'PRESENCE');
  }

  /**
   * Shutdown the Presence API
  */
  function _shutdownPresence() {
    log.log(LOG_PREFIX, 'Shutting down Presence.');
    try {
      if (presence) {
        presence.shutdown();
      }
    } catch (ex) {
      log.warn(LOG_PREFIX, 'Error attempting to shut down Presence.');
    }
    fb.child('config/HomeOnNode/presence/people').off();
    fb.child('config/HomeOnNode/presence/FlicAway').off();
    presence = null;
  }

  /**
   * Init Harmony API
  */
  function _initHarmony() {
    harmony = new Harmony(Keys.harmony.key);
    harmony.on('activity_changed', (activity) => {
      fbSet('state/harmony', activity);
    });
    harmony.on('config_changed', (config) => {
      fbSet('state/harmonyConfig', config);
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


  /**
   * Init Nest
  */
  function _initNest() {
    try {
      nest = new Nest.Nest(Keys.nest.token, fb.child('config/HomeOnNode'));
      nest.on('change', (data) => {
        fbSet('state/nest', data);
      });
    } catch (ex) {
      log.exception(LOG_PREFIX, 'Unable to initialize Nest', ex);
      nest = null;
      return;
    }
  }

  /*****************************************************************************
   *
   * Hue - Initialization & Shut Down
   *
   ****************************************************************************/

  function initHue() {
    try {
      hue = new Hue(Keys.hueBridge.key, null);
    } catch (ex) {
      log.exception(LOG_PREFIX, 'Unable to initialize Hue', ex);
      shutdownHue();
      return;
    }

    if (hue) {
      hue.on('config', function(config) {
        fbSet('state/hue', config);
      });
      hue.on('change_lights', function(lights) {
        fbSet('state/hue/lights', lights);
      });
      hue.on('change_groups', function(groups) {
        fbSet('state/hue/groups', groups);
      });
      hue.on('ready', function(config) {
        fbSet('state/hue', config);
      });
      hue.on('error', function(err) {
        log.error(LOG_PREFIX, 'Hue error occured.', err);
      });
    }
  }

  function shutdownHue() {
    log.log(LOG_PREFIX, 'Shutting down Hue.');
    hue = null;
  }

  function setHueScene(sceneId) {
    if (hue) {
      try {
        return hue.setScene(sceneId);
      } catch (ex) {
        log.exception(LOG_PREFIX, 'Hue scene failed', ex);
        return false;
      }
    }
    log.warn(LOG_PREFIX, 'Hue scene failed, Hue not ready.');
    return false;
  }

  function setHueLights(lights, lightState) {
    if (hue) {
      try {
        return hue.setLights(lights, lightState);
      } catch (ex) {
        log.exception(LOG_PREFIX, 'Hue lights failed', ex);
        return false;
      }
    }
    log.warn(LOG_PREFIX, 'Hue lights failed, Hue not ready.');
    return false;
  }

  /*****************************************************************************
   *
   * Notifications - Initialization & Shut Down
   *
   ****************************************************************************/

  function initNotifications() {
    fb.child('state/hasNotification').on('value', function(snapshot) {
      if (snapshot.val() === true) {
        if (_self.state.systemState === 'HOME') {
          _self.executeCommandByName('NEW_NOTIFICATION', null, 'HOME');
        }
        log.log(LOG_PREFIX, 'New notification received.');
        snapshot.ref().set(false);
      }
    });
  }

  /**
   * Init Push Bullet
  */
  function _initPushBullet() {
    pushBullet = new PushBullet(Keys.pushBullet);
    pushBullet.on('notification', _receivedPushBulletNotification);
  }

  /**
   * Handle incoming PushBullet notification
   *
   * @param {Object} msg Incoming message
   * @param {Number} count Number of visible messages
  */
  function _receivedPushBulletNotification(msg, count) {
    let cmdName;
    if (msg.application_name) {
      cmdName = config.pushBulletNotifications[msg.application_name];
      if (cmdName) {
        _self.executeCommandByName(cmdName, null, 'PushBullet');
      }
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

  /**
   * Init Sonos
  */
  function _initSonos() {
    try {
      sonos = new Sonos();
      sonos.on('ready', () => {
        log.debug(LOG_PREFIX, 'Sonos ready...');
      });
      sonos.on('player-state', (transportState) => {
        transportState = JSON.parse(JSON.stringify(transportState));
        fbSet('state/sonos/state', transportState);
      });
      sonos.on('favorites-changed', (favorites) => {
        favorites = JSON.parse(JSON.stringify(favorites));
        fbSet('state/sonos/favorites', favorites);
      });
    } catch (ex) {
      log.exception(LOG_PREFIX, 'Unable to initialize Sonos', ex);
      sonos = null;
      return;
    }
  }

  /**
   * Init NanoLeaf
  */
  function _initNanoLeaf() {
    let ip = '192.168.86.208';
    let port = 16021;
    nanoLeaf = new NanoLeaf(Keys.nanoLeaf, ip, port);
    nanoLeaf.on('state-changed', (state) => {
      fbSet('state/nanoLeaf', state);
    });
  }

  /*****************************************************************************
   *
   * ZWave - Initialization, Shut Down & Event handlers
   *
   ****************************************************************************/

  function initZWave() {
    try {
      zwave = new ZWave();
    } catch (ex) {
      log.exception('[HOME] Unable to initialize ZWave', ex);
      shutdownZWave();
      return;
    }

    if (zwave) {
      zwave.on('zwave_unavailable', shutdownZWave);
      zwave.on('invalid_network_key', shutdownZWave);
      zwave.on('error', function(err) {
        log.error(LOG_PREFIX, 'ZWave Error', err);
      });
      zwave.on('ready', function(nodes) {
        fbSet('state/zwave/nodes', nodes);
      });
      zwave.on('node_event', zwaveEvent);
    }
  }

  function zwaveEvent(nodeId, value) {
    const device = config.zwave[nodeId];
    if (device) {
      const deviceName = device.label.toUpperCase();
      if (device.kind === 'DOOR') {
        const doorState = value === 255 ? 'OPEN' : 'CLOSED';
        handleDoorEvent(deviceName, doorState, device.updateState);
      } else if (device.kind === 'MOTION') {
        // Only fire motion events when system is in AWAY mode
        if (_self.state.systemState !== 'HOME') {
          const cmdName = 'MOTION_' + deviceName;
          _self.executeCommandByName(cmdName, null, deviceName);
        }
      } else {
        log.warn(LOG_PREFIX, 'Unknown ZWave device kind: ' + nodeId);
      }
    } else {
      log.warn(LOG_PREFIX, 'Unhandled ZWave Event:' + nodeId + ':' + value);
    }
  }

  function shutdownZWave() {
    log.log(LOG_PREFIX, 'Shutting down ZWave.');
    if (zwaveTimer) {
      clearInterval(zwaveTimer);
      zwaveTimer = null;
    }
    try {
      zwave.disconnect();
    } catch (ex) {
      log.warn(LOG_PREFIX, 'Error attempting to shut down Harmony.');
    }
    zwave = null;
    fbSet('state/zwave');
  }

  /*****************************************************************************
   *
   * Main App - Initialization & Shut Down
   *
   ****************************************************************************/

  function init() {
    log.init(LOG_PREFIX, 'Initializing home.');
    const now = Date.now();
    _self.state = {
      doNotDisturb: false,
      hasNotification: false,
      systemState: 'AWAY',
      time: {
        started: now,
        started_: moment(now).format('YYYY-MM-DDTHH:mm:ss.SSS'),
        lastUpdated: now,
        lastUpdated_: moment(now).format('YYYY-MM-DDTHH:mm:ss.SSS'),
      },
      gitHead: version.head,
    };
    fbSet('state/time/started', _self.state.time.started);
    fbSet('state/time/updated', _self.state.time.started);
    fbSet('state/time/started_', _self.state.time.started_);
    fbSet('state/time/updated_', _self.state.time.started_);
    fbSet('state/gitHead', _self.state.gitHead);
    fb.child('state').on('value', function(snapshot) {
      _self.state = snapshot.val();
    });
    fb.child('config/HomeOnNode').on('value', function(snapshot) {
      config = snapshot.val();
      log.log(LOG_PREFIX, 'Config file updated.');
      fs.writeFile('config.json', JSON.stringify(config, null, 2));
    });
    gcmPush = new GCMPush(fb);
    initNotifications();
    initZWave();
    _initNest();
    initHue();
    _initNanoLeaf();
    _initSonos();
    _initHarmony();
    _initPresence();
    _initPushBullet();
    _initWeather();
    setTimeout(function() {
      log.log(LOG_PREFIX, 'Ready');
      _self.emit('ready');
    }, 750);
    _playSound(config.readySound);
  }

  this.shutdown = function() {
    shutdownHue();
    shutdownZWave();
    _shutdownHarmony();
    _shutdownPresence();
    _shutdownPushBullet();
  };

  init();
}

util.inherits(Home, EventEmitter);

module.exports = Home;
