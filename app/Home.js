'use strict';

var EventEmitter = require('events').EventEmitter;
var util = require('util');
var exec = require('child_process').exec;
var log = require('./SystemLog');
var Keys = require('./Keys').keys;
var version = require('./version');
var moment = require('moment');
var fs = require('fs');

var Firebase = require('firebase');
var Harmony = require('./Harmony');
var Hue = require('./Hue');
var Presence = require('./Presence');
var Nest = require('./Nest');
var ZWave = require('./ZWave');

function Home(config, fb) {
  this.state = {};
  var _self = this;

  var nest;
  var hue;
  var harmony;
  var zwave;
  var presence;

  var armingTimer;
  var zwaveTimer;

  /*****************************************************************************
   *
   * Primary commands
   *
   ****************************************************************************/

  function getLightSceneByName(sceneName) {
    var defaultScene = {bri: 254, ct: 369, on: true};
    sceneName = sceneName.toString();
    if (sceneName) {
      try {
        sceneName = sceneName.toUpperCase();
        var result = config.lightScenes[sceneName];
        if (result.hue) {
          return result.hue;
        }
      } catch (ex) {
        log.error('[HOME] Error retreiving light scene: ' + sceneName);
        return defaultScene;
      }
    }
    log.warn('[HOME] Could not determine light scene: ' + sceneName);
    return defaultScene;
  }

  this.handleKeyEntry = function(key, modifier, sender) {
    try {
      var cmdName = config.keypad.keys[key];
      if (cmdName) {
        _self.executeCommandByName(cmdName, modifier, sender);
      } else {
        log.warn('[HOME] Unknown key pressed: ' + key);
      }
    } catch (ex) {
      log.exception('[HOME] Error handling key entry.', ex);
    }
  };

  this.executeCommandByName = function(commandName, modifier, source) {
    var msg = '[HOME] executeCommandByName: ' + commandName;
    if (modifier) {
      msg += ' (' + modifier + ')';
    }
    msg += ' received from: ' + source;
    log.log(msg);
    var command = config.commands[commandName];
    if (command) {
      command.modifier = modifier;
      _self.executeCommand(command, source);
      return;
    }
    log.warn('[HOME] Command (' + commandName + ') not found.');
  };

  this.executeCommand = function(command, source) {
    var modifier = command.modifier;
    var msg = '[HOME] executeCommand ';
    msg += '. [' + Object.keys(command) + ']';
    if (modifier) {
      msg += ' (' + modifier + ')';
    }
    msg += ' received from: ' + source;
    log.log(msg);
    var cmds;
    if (command.hasOwnProperty('state')) {
      setState(command.state);
    }
    if (command.hasOwnProperty('hueScene')) {
      var scenes = command.hueScene;
      if (Array.isArray(scenes) === false) {
        scenes = [scenes];
      }
      scenes.forEach(function(scene) {
        setHueScene(scene);
      });
    }
    if (command.hasOwnProperty('hueCommand')) {
      cmds = command.hueCommand;
      if (Array.isArray(cmds) === false) {
        cmds = [cmds];
      }
      cmds.forEach(function(cmd) {
        var scene;
        if (modifier) {
          scene = getLightSceneByName(modifier);
        } else if (cmd.lightState) {
          scene = cmd.lightState;
        } else {
          scene = getLightSceneByName(cmd.lightStateName);
        }
        setHueLights(cmd.lights, scene);
      });
    }
    if (command.hasOwnProperty('nestThermostat')) {
      cmds = command.nestThermostat;
      if (Array.isArray(cmds) === false) {
        cmds = [cmds];
      }
      cmds.forEach(function(cmd) {
        setNestThermostat(cmd.id, cmd.mode, cmd.temperature, modifier);
      });
    }
    if (command.hasOwnProperty('harmonyActivity')) {
      setHarmonyActivity(command.harmonyActivity);
    }
    if (command.hasOwnProperty('harmonyKey')) {
      sendHarmonyKey(command.harmonyKey);
    }
    if (command.hasOwnProperty('nestCam')) {
      var enabled = command.nestCam;
      if (modifier === 'OFF') {
        enabled = 'OFF';
      }
      enableNestCam(enabled);
    }
    if (command.hasOwnProperty('sound')) {
      playSound(command.sound, command.soundForce);
    }
    if (command.hasOwnProperty('doNotDisturb')) {
      if (modifier === 'OFF' || command.doNotDisturb === 'OFF') {
        setDoNotDisturb('OFF');
      } else {
        setDoNotDisturb('ON');
      }
    }
  };

  this.ringDoorbell = function(source) {
    log.log('[HOME] Doorbell');
    fbSet('state/lastDoorbell', Date.now());
    return _self.executeCommandByName('RUN_ON_DOORBELL', null, source);
  };

  /*****************************************************************************
   *
   * Primary command helpers
   *
   ****************************************************************************/

  function handleDoorEvent(doorName, doorState, updateState) {
    try {
      if (_self.state.doors[doorName] === doorState) {
        log.info('[HOME] Door debouncer, door already ' + doorState);
        return;
      }
    } catch (ex) {
      // NoOp - if the door wasn't set before, it will be now.
    }
    fbSet('state/doors/' + doorName, doorState);
    var now = Date.now();
    var doorLogObj = {
      level: 'INFO',
      message: doorName + ' door ' + doorState,
      doorName: doorName,
      state: doorState,
      date: now,
      date_: moment(now).format('YYYY-MM-DDTHH:mm:ss.SSS')
    };
    fbPush('logs/doors', doorLogObj);
    log.log('[HOME] ' + doorName + ' ' + doorState);
    if (updateState === true) {
      if (_self.state.systemState === 'AWAY' && doorState === 'OPEN') {
        setState('HOME');
      }
    }
    var cmdName = 'DOOR_' + doorName;
    var modifier;
    if (doorState === 'CLOSED') {
      modifier = 'OFF';
    }
    return _self.executeCommandByName(cmdName, modifier, 'DOOR_' + doorName);
  }

  function setDoNotDisturb(val) {
    log.log('[HOME] setDoNotDisturb: ' + val);
    if (val === 'ON') {
      fbSet('state/doNotDisturb', true);
      log.log('[HOME] Do not disturb: enabled');
      return true;
    } else if (val === 'OFF') {
      fbSet('state/doNotDisturb', false);
      log.log('[HOME] Do not disturb: disabled');
      return true;
    }
    log.error('[HOME] Unknown doNotDisturb state: ' + val);
    return false;
  }

  function setState(newState) {
    log.log('[HOME] setState: ' + newState);
    if (armingTimer) {
      clearTimeout(armingTimer);
      armingTimer = null;
    }
    var armingDelay = config.armingDelay || 90000;
    if (newState === 'ARMED') {
      armingTimer = setTimeout(function() {
        armingTimer = null;
        setState('AWAY');
      }, armingDelay);
    }
    if (_self.state.systemState === newState) {
      log.warn('[HOME] State already set to ' + newState);
      return false;
    }
    fbSet('state/systemState', newState);
    var now = Date.now();
    var stateLog = {
      level: 'INFO',
      message: newState,
      state: newState,
      date: now,
      date_: moment(now).format('YYYY-MM-DDTHH:mm:ss.SSS')
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

  function playSound(file, force) {
    log.log('[HOME] playSound: ' + file + ' ' + force);
    if (_self.state.doNotDisturb === false || force === true) {
      setTimeout(function() {
        var cmd = 'mplayer ';
        cmd += file;
        exec(cmd, function(error, stdout, stderr) {
          if (error) {
            log.exception('[HOME] PlaySound Error', error);
          }
        });
        log.debug('[HOME] PlaySound: ' + file);
      }, 1);
    }
  }

  /*****************************************************************************
   *
   * Firebase & Log Helpers
   *
   ****************************************************************************/

  function fbPush(path, value) {
    var fbObj = fb;
    if (path) {
      fbObj = fb.child(path);
    }
    try {
      fbObj.push(value, function(err) {
        if (err) {
          log.exception('[HOME] Unable to push data to Firebase. (CB)', err);
        }
      });
      fbSetLastUpdated();
    } catch (ex) {
      log.exception('[HOME] Unable to PUSH data to Firebase. (TC)', ex);
    }
  }

  function fbSet(path, value) {
    var fbObj = fb;
    if (path) {
      fbObj = fb.child(path);
    }
    try {
      if (value === null) {
        fbObj.remove();
      } else {
        fbObj.set(value, function(err) {
          if (err) {
            log.exception('[HOME] Set data failed on path: ' + path, err);
          }
        });
      }
      fbSetLastUpdated();
    } catch (ex) {
      log.exception('[HOME] Unable to set data on path: ' + path, ex);
    }
  }

  function fbSetLastUpdated() {
    var now = Date.now();
    fb.child('state/time').update({
      lastUpdated: now,
      lastUpdated_: moment(now).format('YYYY-MM-DDTHH:mm:ss.SSS')
    });
  }

  /*****************************************************************************
   *
   * Weather - Initialization
   *
   ****************************************************************************/

  function initWeather() {
    var url = 'https://publicdata-weather.firebaseio.com/';
    url += config.fbWeatherCity;
    var weatherRef = new Firebase(url);
    weatherRef.child('currently').on('value', function(snapshot) {
      fbSet('state/weather/now', snapshot.val());
    });
    weatherRef.child('daily/data/0').on('value', function(snapshot) {
      fbSet('state/weather/today', snapshot.val());
    });
  }

  /*****************************************************************************
   *
   * Presence - Initialization & Shut Down
   *
   ****************************************************************************/

  function initPresence() {
    try {
      presence = new Presence();
    } catch (ex) {
      log.exception('[HOME] Unable to initialize Presence', ex);
      shutdownPresence();
      return;
    }

    if (presence) {
      presence.on('adapterError', shutdownPresence);
      presence.on('presence_unavailable', shutdownPresence);
      presence.on('error', function(err) {
        log.exception('[HOME] Presence error', err);
      });
      presence.on('change', function(person, present, who) {
        var presenceLog = {
          level: 'INFO',
          message: person.name + ' is ' + person.state,
          name: person.name,
          state: person.state,
          date: person.lastSeen,
          date_: person.lastSeen_
        };
        fbPush('logs/presence', presenceLog);
        fbSet('state/presence', who);
        var cmdName = 'PRESENCE_SOME';
        if (present === 0) {
          cmdName = 'PRESENCE_NONE';
        }
        _self.executeCommandByName(cmdName, null, 'PRESENCE');
      });
      var fbPresPath = 'config/HomeOnNode/presence/people';
      fb.child(fbPresPath).on('child_added', function(snapshot) {
        if (presence) {
          presence.addPerson(snapshot.val());
        }
      });
      fb.child(fbPresPath).on('child_removed', function(snapshot) {
        if (presence) {
          var uuid = snapshot.val().uuid;
          presence.removePersonByKey(uuid);
        }
      });
      fb.child(fbPresPath).on('child_changed', function(snapshot) {
        if (presence) {
          presence.updatePerson(snapshot.val());
        }
      });
    }
  }

  function shutdownPresence() {
    log.log('[HOME] Shutting down Presence.');
    try {
      presence.shutdown();
    } catch (ex) {
      log.debug('[HOME] Error attempting to shut down Presence.');
    }
    var fbPresPath = 'config/HomeOnNode/presence/people';
    fb.child(fbPresPath).off();
    presence = null;
  }

  /*****************************************************************************
   *
   * Harmony - Initialization & Shut Down
   *
   ****************************************************************************/

  function initHarmony() {
    try {
      harmony = new Harmony(Keys.harmony.key);
    } catch (ex) {
      log.exception('[HOME] Unable to initialize Harmony', ex);
      shutdownHarmony();
      return;
    }

    if (harmony) {
      harmony.on('ready', function(config) {
      });
      harmony.on('activity', function(activity) {
        fbSet('state/harmony', activity);
        log.log('[HOME] Harmony activity is: ' + JSON.stringify(activity));
      });
      harmony.on('no_hubs_found', shutdownHarmony);
      harmony.on('connection_failed', shutdownHarmony);
      harmony.on('error', function(err) {
        log.exception('[HOME] Harmony error occured.', err);
      });
    }
  }

  function shutdownHarmony() {
    log.log('[HOME] Shutting down Harmony.');
    try {
      harmony.close();
    } catch (ex) {
      log.debug('[HOME] Error attempting to shut down Harmony.');
    }
    harmony = null;
  }

  function setHarmonyActivity(activityName) {
    log.log('[HOME] setHarmonyActivity: ' + activityName);
    if (harmony) {
      try {
        harmony.setActivityByName(activityName);
        return true;
      } catch (ex) {
        log.exception('[HOME] Harmony activity failed', ex);
        return false;
      }
    }
    log.warn('[HOME] Harmony activity failed, Harmony not ready.');
    return false;
  }

  function sendHarmonyKey(harmonyKey) {
    log.log('[HOME] sendHarmonyKey: ' + harmonyKey);
    if (harmony) {
      try {
        harmony.sendCommand(harmonyKey);
        return true;
      } catch (ex) {
        log.exception('[HOME] Harmony command failed', ex);
        return false;
      }
    }
    log.warn('[HOME] Harmony command failed, Harmony not ready.');
    return false;
  }

  /*****************************************************************************
   *
   * Nest - Initialization & Shut Down
   *
   ****************************************************************************/

  function initNest() {
    try {
      nest = new Nest();
      log.todo('[HOME] Setup Nest Alarms');
    } catch (ex) {
      log.exception('[HOME] Unable to initialize Nest', ex);
      shutdownNest();
      return;
    }

    if (nest) {
      nest.login(Keys.nest.token);
      nest.on('authError', function(err) {
        log.exception('[HOME] Nest auth error occured.', err);
        shutdownNest();
      });
      nest.on('change', function(data) {
        log.debug('[HOME] Nest changed');
        fbSet('state/nest', data);
      });
      nest.on('alarm', function(kind, protect) {
        // TODO
        var msg = '[HOME] Nest Alarm NYI!!';
        msg += ' kind: ' + JSON.stringify(kind);
        msg += ' protect: ' + JSON.stringify(protect);
        log.warn(msg);
        var cmd = {
          sound: 'sounds/bell.mp3',
          forceSound: true
        };
        _self.executeCommand(cmd);
      });
      nest.on('ready', function(data) {
        nest.enableListener();
      });
    }
  }

  function shutdownNest() {
    log.log('[HOME] Shutting down Nest.');
    nest = null;
  }

  function enableNestCam(enabled) {
    log.log('[HOME] enableNestCam: ' + enabled);
    if (nest) {
      try {
        if (enabled === 'YES') {
          nest.enableCamera();
          return true;
        }
        nest.disableCamera();
        return true;
      } catch (ex) {
        log.exception('[HOME] Failed to update NestCam', ex);
        return false;
      }
    }
    log.warn('[HOME] NestCam command failed, Nest not ready.');
    return false;
  }

  function setNestThermostat(id, mode, temperature, modifier) {
    log.todo('[HOME] setNestThermostat');
    return false;
    if (nest) {
      try {
        if (modifier === 'OFF') {
          mode = 'off';
        } else if (modifier === 'UP') {
          log.todo('[HOME] Nest Thermostat Modifier UP NYI');
          return false;
        } else if (modifier === 'DOWN') {
          log.todo('[HOME] Nest Thermostat Modifier DOWN NYI');
          return false;
        }
        nest.setTemperature(id, mode, temperature);
        return true;
      } catch (ex) {
        log.exception('[HOME] Failed to set Nest thermostat', ex);
        return false;
      }
    }
    log.warn('[HOME] Nest thermostat command failed, Nest not ready.');
    return false;
  }

  /*****************************************************************************
   *
   * Hue - Initialization & Shut Down
   *
   ****************************************************************************/

  function initHue() {
    try {
      hue = new Hue(Keys.hueBridge.key);
    } catch (ex) {
      log.exception('[HOME] Unable to initialize Hue', ex);
      shutdownHue();
      return;
    }

    if (hue) {
      hue.on('no_hubs_found', function() {
        log.error('[HOME] No Hue Hubs found.');
        shutdownHue();
      });
      hue.on('change', function(hueState) {
        fbSet('state/hue', hueState);
        hueAwayToggle(hueState.sensors);
      });
      hue.on('ready', function() {
      });
      hue.on('error', function(err) {
        log.error('[HOME] Hue error occured.' + JSON.stringify(err));
      });
    }
  }

  function hueAwayToggle(sensors) {
    var sensorId = config.hueAwaySensorToggleId;
    if (sensorId && sensors && sensors[sensorId]) {
      var sensor = sensors[sensorId];
      if (sensor.modelid !== 'awayToggler') {
        log.error('[HOME] Invalid Hue Sensor type for Away Toggler.');
        return;
      }
      if (sensor.state.flag === true) {
        hue.setSensorFlag(sensorId, false);
        log.log('[HOME] State change triggered by Hue');
        if (_self.state.systemState === 'HOME') {
          setState('ARMED');
        } else {
          setState('HOME');
        }
      }
    }
  }

  function shutdownHue() {
    log.log('[HOME] Shutting down Hue.');
    hue = null;
  }

  function setHueScene(sceneId) {
    log.log('[HOME] setHueScene: ' + sceneId);
    if (hue) {
      try {
        hue.activateScene(sceneId);
        return true;
      } catch (ex) {
        log.exception('[HOME] Hue scene failed', ex);
        return false;
      }
    }
    log.warn('[HOME] Hue scene failed, Hue not ready.');
    return false;
  }

  function setHueLights(lights, lightState) {
    log.log('[HOME] setHueLights');
    if (hue) {
      try {
        hue.setLightState(lights, lightState);
        return true;
      } catch (ex) {
        log.exception('[HOME] Hue lights failed', ex);
        return false;
      }
    }
    log.warn('[HOME] Hue lights failed, Hue not ready.');
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
        log.log('[HOME] New notification received.');
        snapshot.ref().set(false);
      }
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
      log.todo('[HOME] Setup ZWave Timer');
    } catch (ex) {
      log.exception('[HOME] Unable to initialize ZWave', ex);
      shutdownZWave();
      return;
    }

    if (zwave) {
      zwave.on('zwave_unavailable', shutdownZWave);
      zwave.on('invalid_network_key', shutdownZWave);
      zwave.on('error', function(err) {
        log.error('[HOME] ZWave Error: ' + JSON.stringify(err));
      });
      zwave.on('ready', function(nodes) {
        fbSet('state/zwave/nodes', nodes);
        zwaveTimer = setInterval(zwaveTimerTick, 30000);
      });
      zwave.on('node_event', zwaveEvent);
      zwave.on('node_value_change', zwaveSaveNodeValue);
      zwave.on('node_value_refresh', zwaveSaveNodeValue);
      zwave.on('node_value_removed', function(nodeId, info) {
        var msg = '[' + nodeId + '] ' + JSON.stringify(info);
        log.warn('[HOME] ZWave - nodeValueRemoved: ' + msg);
      });
    }
  }

  function zwaveEvent(nodeId, value) {
    var device = config.zwave[nodeId];
    if (device) {
      var deviceName = device.label.toUpperCase();
      if (device.kind === 'DOOR') {
        var doorState = value === 255 ? 'OPEN' : 'CLOSED';
        handleDoorEvent(deviceName, doorState, device.updateState);
      } else if (device.kind === 'MOTION') {
        var cmdName = 'MOTION_' + deviceName;
        _self.executeCommandByName(cmdName, null, deviceName);
      } else {
        log.warn('[HOME] Unknown ZWave device kind: ' + nodeId);
      }
    } else {
      log.warn('[HOME] Unhandled ZWave Event:' + nodeId + ':' + value);
    }
  }

  function zwaveSaveNodeValue(nodeId, info) {
    /* jshint -W106 */
    // jscs:disable requireCamelCaseOrUpperCaseIdentifiers
    var valueId = info.value_id;
    // jscs:enable
    /* jshint +W106 */
    if (valueId) {
      try {
        var path;
        valueId = valueId.replace(nodeId + '-', '');
        if (valueId === '49-1-1') { // Temperature
          path = 'temperature';
        } else if (valueId === '49-1-5') { // Humidity
          path = 'humidity';
        } else if (valueId === '49-1-3') { // Luminance
          path = 'luminance';
        } else if (valueId === '49-1-27') { // UV
          path = 'uv';
        } else if (valueId === '128-1-0') { // Battery
          path = 'battery';
        } else if (valueId === '113-1-1') { // Alarm
          path = 'alarm';
        } else {
          path = valueId;
        }
        var now = new Date();
        var value = {
          date: now,
          date_: moment(now).format('YYYY-MM-DDTHH:mm:ss.SSS')
        };
        value.value = info.value;
        if (info.value === undefined || info.value === null) {
          value.value = info;
        }
        var nodeName = config.zwave[nodeId].label || nodeId;
        path = 'state/sensor/' + nodeName + '/' + path;
        fbSet(path, value);
        log.log('[HOME] ZWave - saveNodeValue: ' + path + ': ' + value.value);
      } catch (ex) {
        log.exception('[HOME] Error in saveNodeValue', ex);
      }
    } else {
      log.error('[HOME] ZWave - no valueId for saveNodeValue');
    }
  }

  function zwaveTimerTick() {
    //log.debug('[HOME] ZWave Timer Tick');
    var nodes = zwave.getNode();
    fbSet('state/zwave/nodes', nodes);
  }

  function shutdownZWave() {
    log.log('[HOME] Shutting down ZWave.');
    if (zwaveTimer) {
      clearInterval(zwaveTimer);
      zwaveTimer = null;
    }
    try {
      zwave.disconnect();
    } catch (ex) {
      log.debug('[HOME] Error attempting to shut down Harmony.');
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
    log.init('[HOME] Initializing home.');
    var now = Date.now();
    _self.state = {
      doNotDisturb: false,
      hasNotification: false,
      systemState: 'AWAY',
      time: {
        started: now,
        started_: moment(now).format('YYYY-MM-DDTHH:mm:ss.SSS'),
        lastUpdated: now,
        lastUpdated_: moment(now).format('YYYY-MM-DDTHH:mm:ss.SSS')
      },
      gitHead: version.head
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
      log.log('[HOME] Config file updated.');
      fs.writeFile('config.json', JSON.stringify(config, null, 2));
    });
    initNotifications();
    initZWave();
    initNest();
    initHue();
    initHarmony();
    initPresence();
    initWeather();
    setTimeout(function() {
      log.log('[HOME] Ready');
      _self.emit('ready');
    }, 750);
    playSound(config.readySound);
  }

  this.shutdown = function() {
    shutdownHarmony();
    shutdownHue();
    shutdownNest();
    shutdownZWave();
    shutdownPresence();
  };

  init();
}

util.inherits(Home, EventEmitter);

module.exports = Home;
