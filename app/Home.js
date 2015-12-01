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

  function getCommandByName(commandName) {
    var result = config.commands[commandName];
    if (result) {
      return result;
    } else {
      log.error('[HOME] Unable to find command: ' + commandName);
      return {};
    }
  }

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
    var result = {};
    var msg = '[HOME] Command received: ' + commandName + ' [' + modifier + ']';
    msg += ' from ' + source;
    log.log(msg);
    var command = getCommandByName(commandName);
    if (command) {
      result = _self.executeCommand(command, modifier, source);
    } else {
      msg = '[HOME] Command (' + commandName + ') not found.';
      log.warn(msg);
      result = {error: msg};
    }
    return result;
  };

  this.executeCommand = function(command, modifier, source) {
    var result = {};
    if (command.state) {
      setState(command.state);
    }
    if (command.hue) {
      if (hue) {
        result.hue = [];
        command.hue.forEach(function(cmd) {
          var scene;
          if (modifier) {
            scene = getLightSceneByName(modifier);
          } else {
            scene = getLightSceneByName(cmd.command);
          }
          try {
            hue.setLightState(cmd.lights, scene);
            result.hue.push({lights: cmd.lights, scene: scene});
          } catch (ex) {
            log.exception('[HOME] Hue command failed', ex);
            result.hue.push({lights: cmd.lights, scene: scene, error: ex});
          }
        });
      } else {
        result.hue = '[HOME] Hue command failed, Hue not ready.';
        log.warn(result.hue);
      }
    }
    if (command.zwave) {
      if (zwave) {
        result.zwave = [];
        var keys = Object.keys(command.zwave);
        keys.forEach(function(k) {
          var onOff = command.zwave[k];
          if (modifier === 'OFF') {
            onOff = false;
          }
          try {
            result.zwave.push(zwave.setNodeBinary(k, onOff));
          } catch (ex) {
            log.exception('[HOME] ZWave command failed', ex);
            result.zwave.push({zwave: k, onOff: onOff, error: ex});
          }
        });
      } else {
        result.zwave = '[HOME] ZWave command failed, ZWave not ready.';
        log.warn(result.zwave);
      }
    }
    if (command.zwaveAdmin) {
      if (zwave) {
        try {
          if (command.zwaveAdmin === 'addDevice') {
            result.zwaveAdmin = zwave.addDevice();
          } else if (command.zwaveAdmin === 'healNetwork') {
            result.zwaveAdmin = zwave.healNetwork();
          }
        } catch (ex) {
          log.exception('[HOME] ZWave AddDevice command failed', ex);
          result.zwaveAdmin = ex;
        }
      } else {
        result.zwaveAdmin = '[HOME] ZWave command failed, ZWave not ready.';
        log.warn(result.zwaveAdmin);
      }
    }
    if (command.nest) {
      command.nest.forEach(function(cmd) {
        result.nest = [];
        /* jshint -W106 */
        // jscs:disable requireCamelCaseOrUpperCaseIdentifiers
        var thermostatId = cmd.thermostatId;
        var mode = cmd.hvac_mode;
        var temperature = cmd.targetTemperature;
        var current = _self.state.nest.devices.thermostats[thermostatId];
        if (modifier === 'OFF') {
          mode = 'off';
        } else if (modifier === 'DOWN') {
          temperature = current.target_temperature_f - 1;
        } else if (modifier === 'UP') {
          temperature = current.target_temperature_f + 1;
        }
        result.nest.push(setNestThermostat(thermostatId, temperature, mode));
        /* jshint +W106 */
        // jscs:enable
      });
    }
    if (command.harmony) {
      if (harmony) {
        try {
          result.harmony = harmony.setActivityByName(command.harmony);
        } catch (ex) {
          log.exception('[HOME] Harmony activity failed', ex);
          result.harmony = ex;
        }
      } else {
        result.harmony = '[HOME] Harmony activity failed, Harmony not ready.';
        log.warn(result.harmony);
      }
    }
    if (command.dropcam === true || command.dropcam === false) {
      if (nest) {
        try {
          if (modifier === 'OFF' || command.dropcam === false) {
            nest.disableCamera();
            result.dropcam = false;
          } else {
            nest.enableCamera();
            result.dropcam = true;
          }
        } catch (ex) {
          log.exception('[HOME] Nest Cam change failed', ex);
          result.dropcam = ex;
        }
      } else {
        result.dropcam = '[HOME] Nest Cam change failed, Nest cam not ready.';
        log.warn(result.dropcam);
      }
    }
    if (command.sound) {
      playSound(command.sound);
    }
    if (command.doNotDisturb === true || command.doNotDisturb === false) {
      if (modifier === 'OFF') {
        command.doNotDisturb = false;
      }
      setDoNotDisturb(command.doNotDisturb);
      result.doNotDisturb = command.doNotDisturb;
    }
    return result;
  };

  /*****************************************************************************
   *
   * Primary command helpers
   *
   ****************************************************************************/

  function setNestThermostat(thermostatId, targetTemperature, mode) {
    /* jshint -W106 */
    // jscs:disable requireCamelCaseOrUpperCaseIdentifiers
    if (nest) {
      var current = _self.state.nest.devices.thermostats[thermostatId];
      if (!targetTemperature) {
        targetTemperature = current.target_temperature_f;
      }
      if (!mode) {
        mode = current.hvac_mode;
      }
      return nest.setTemperature(thermostatId, targetTemperature, mode);
    } else {
      log.warn('[HOME] Nest thermostat change failed, Nest not ready.');
    }
    /* jshint +W106 */
    // jscs:enable
  }

  function handleDoorEvent(doorName, doorState, updateState) {
    fbSet('state/doors/' + doorName, doorState);
    var now = Date.now();
    var doorLogObj = {
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
    return _self.executeCommandByName(cmdName, modifier);
  }

  function setDoNotDisturb(val) {
    _self.state.doNotDisturb = val;
    fbSet('state/doNotDisturb', val);
    log.debug('[HOME] Do Not Disturb set to: ' + val);
  }

  function setState(newState) {
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
      return;
    }
    _self.state.systemState = newState;
    fbSet('state/systemState', newState);
    fbPush('logs/systemState', {'date': Date.now(), 'state': newState});
    log.log('[HOME] State changed to: ' + newState);
    if (nest) {
      if (newState === 'AWAY' || newState === 'ARMED') {
        nest.setAway();
      } else {
        nest.setHome();
      }
    }
    _self.executeCommandByName('RUN_ON_' + newState);
    return newState;
  }

  function playSound(file) {
    if (_self.state.doNotDisturb === false) {
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
      fbObj.push(value);
      var now = Date.now();
      fb.child('state/time').update({
        lastUpdated: now,
        lastUpdated_: moment(now).format('YYYY-MM-DDTHH:mm:ss.SSS')
      });
      _self.state.time.lastUpdated = now;
    } catch (ex) {
      log.exception('[HOME] Unable to PUSH data to firebase.', ex);
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
        fbObj.set(value);
      }
      var now = Date.now();
      fb.child('state/time').update({
        lastUpdated: now,
        lastUpdated_: moment(now).format('YYYY-MM-DDTHH:mm:ss.SSS')
      });
      _self.state.time.lastUpdated = now;
    } catch (ex) {
      log.exception('[FBSet] Unable to set data on path: ' + path, ex);
    }
  }

  function generateLastError(err, description) {
    var now = Date.now();
    var result = {
      date: now,
      date_: moment(now).format('YYYY-MM-DDTHH:mm:ss.SSS')
    };
    if (err) {
      result.error = err;
    }
    if (description) {
      result.description = description;
    }
    return result;
  }

  /*****************************************************************************
   *
   * Outside Temperature - Initialization
   *
   ****************************************************************************/

  function initOutsideTemp() {
    _self.state.temperature = _self.state.temperature || {};
    var url = 'https://publicdata-weather.firebaseio.com/';
    url += config.fbWeatherCity;
    var weatherRef = new Firebase(url);
    weatherRef.child('currently/temperature').on('value', function(snapshot) {
      var temp = snapshot.val();
      _self.state.temperature.outside = temp;
      fbSet('state/temperature', _self.state.temperature);
      log.debug('[HOME] Outside temperature is ' + temp + 'F');
    });
    weatherRef.child('daily/data/0').on('value', function(snapshot) {
      var snap = snapshot.val();
      _self.state.time.sunrise = snap.sunriseTime * 1000;
      _self.state.time.sunrise_ = moment(snap.sunriseTime * 1000).format();
      _self.state.time.sunset = snap.sunsetTime * 1000;
      _self.state.time.sunset_ = moment(snap.sunsetTime * 1000).format();
      fbSet('state/time', _self.state.time);
      log.debug('[HOME] Sunrise is at ' + _self.state.time.sunrise_);
      log.debug('[HOME] Sunset is at ' + _self.state.time.sunset_);
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
      _self.state.presence = {};
    } catch (ex) {
      log.exception('[HOME] Unable to initialize Presence', ex);
      shutdownPresence();
      return;
    }

    if (presence) {
      presence.on('adapterError', shutdownPresence);
      presence.on('presence_unavailable', shutdownPresence);
      presence.on('error', function(err) {
        log.debug('[HOME] Presence error, whoops!');
        _self.state.presence.lastError = generateLastError(err, 'presence');
        fbSet('state/presence', _self.state.presence);
      });
      presence.on('change', function(person, present, who) {
        person.date = Date.now();
        fbPush('logs/presence', person);
        _self.state.presence = who;
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
    fbSet('state/presence', null);
  }

  /*****************************************************************************
   *
   * Harmony - Initialization & Shut Down
   *
   ****************************************************************************/

  function initHarmony() {
    try {
      harmony = new Harmony(Keys.harmony.key);
      _self.state.harmony = {};
    } catch (ex) {
      log.exception('[HOME] Unable to initialize Harmony', ex);
      shutdownHarmony();
      return;
    }

    if (harmony) {
      harmony.on('ready', function(config) {
        _self.state.harmony.ready = true;
        fbSet('state/harmony', _self.state.harmony);
      });
      harmony.on('activity', function(activity) {
        _self.state.harmony = activity;
        fbSet('state/harmony', _self.state.harmony);
        log.log('[HOME] Harmony activity is: ' + JSON.stringify(activity));
        var activityLabel = activity.label;
        if (activityLabel) {
          var cmdName = 'RUN_ON_H_';
          activityLabel = activityLabel.replace(/ /g, '_');
          activityLabel = activityLabel.toUpperCase();
          cmdName += activityLabel;
          _self.executeCommandByName(cmdName, null, 'HARMONY');
        }
      });
      harmony.on('no_hubs_found', shutdownHarmony);
      harmony.on('connection_failed', shutdownHarmony);
      harmony.on('error', function(err) {
        log.error('[HOME] Harmony error occured.');
        _self.state.harmony.lastError = generateLastError(err, 'harmony');
        fbSet('state/harmony', _self.state.harmony);
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
    fbSet('state/harmony', null);
  }

  /*****************************************************************************
   *
   * Nest - Initialization & Shut Down
   *
   ****************************************************************************/

  function initNest() {
    try {
      nest = new Nest();
      _self.state.nest = {};
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
        _self.state.nest = data;
        fbSet('state/nest', _self.state.nest);
      });
      nest.on('alarm', function(kind, protect) {
        _self.executeCommandByName('NEST_ALARM', null, 'NEST-' + protect);
        var alarm = {
          kind: kind,
          protect: protect
        };
        _self.state.nest.lastAlarm = generateLastError('NEST_ALARM', alarm);
        fbSet('state/nest', _self.state.nest);
      });
      nest.on('ready', function(data) {
        _self.state.nest.ready = true;
        nest.enableListener();
        fbSet('state/nest', _self.state.nest);
      });
    }
  }

  function shutdownNest() {
    log.log('[HOME] Shutting down Nest.');
    nest = null;
    fbSet('state/nest', null);
  }

  /*****************************************************************************
   *
   * Hue - Initialization & Shut Down
   *
   ****************************************************************************/

  function initHue() {
    try {
      hue = new Hue(Keys.hueBridge.key);
      _self.state.hue = {};
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
      hue.on('change', function(lights, groups) {
        _self.state.hue.lights = lights;
        _self.state.hue.groups = groups;
        fbSet('state/hue', _self.state.hue);
      });
      hue.on('ready', function() {
        _self.state.hue.ready = true;
        fbSet('state/hue', _self.state.hue);
      });
      hue.on('error', function(err) {
        log.error('[HOME] Hue error occured.');
        _self.state.hue.lastError = generateLastError(err, 'hue');
        fbSet('state/hue', _self.state.hue);
      });
    }
  }

  function shutdownHue() {
    log.log('[HOME] Shutting down Hue.');
    hue = null;
    fbSet('state/hue', null);
  }

  /*****************************************************************************
   *
   * Notifications - Initialization & Shut Down
   *
   ****************************************************************************/

  function initNotifications() {
    fb.child('state/hasNotification').on('value', function(snapshot) {
      _self.state.hasNotification = snapshot.val();
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
      _self.state.zwave = {};
    } catch (ex) {
      log.exception('[HOME] Unable to initialize ZWave', ex);
      shutdownZWave();
      return;
    }

    if (zwave) {
      //zwave_unavailable, error, polling_enabled, polling_disabled, node_event
      //connected, driver_ready, driver_failed, ready, node_value_change,
      //node_value_refresh, node_value_removed
      zwave.on('zwave_unavailable', shutdownZWave);
      zwave.on('invalid_network_key', shutdownZWave);
      zwave.on('error', function(err) {
        _self.state.zwave.lastError = generateLastError(err, 'zwave');
        log.error('[HOME] ZWave Error: ' + JSON.stringify(err));
        fbSet('state/zwave', _self.state.zwave);
      });
      zwave.on('ready', function(nodes) {
        _self.state.zwave.ready = true;
        _self.state.zwave.nodes = nodes;
        fbSet('state/zwave', _self.state.zwave);
        zwaveTimer = setInterval(zwaveTimerTick, 30000);
      });
      zwave.on('node_event', zwaveEvent);
      zwave.on('node_value_change', zwaveSaveNodeValue);
      zwave.on('node_value_refresh', zwaveSaveNodeValue);
      zwave.on('node_value_removed', function(nodeId, info) {
        var msg = '[' + nodeId + '] ' + JSON.stringify(info);
        log.log('[HOME] ZWave - nodeValueRemoved: ' + msg);
      });
    }
  }

  function zwaveEvent(nodeId, value) {
    var device = config.zwave[nodeId];
    if (device) {
      var doorState;
      var cmdName;
      var deviceName = device.label.toUpperCase();
      if (device.kind === 'DOOR') {
        doorState = value === 255 ? 'OPEN' : 'CLOSED';
        handleDoorEvent(deviceName, doorState, device.updateState);
      } else if (device.kind === 'MOTION') {
        cmdName = 'MOTION_' + deviceName;
        _self.executeCommandByName(cmdName, null, deviceName);
      } else {
        log.warn('[HOME] Unknown ZWave device kind: ' + nodeId);
      }
      _self.state.zwave.nodes[nodeId].lastEvent = value;
      var path = 'state/zwave/nodes/' + nodeId + '/lastEvent';
      fbSet(path, value);
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
        valueId = valueId.replace(nodeId + '-', '');
        _self.state.zwave.nodes[nodeId][valueId] = info;
        var path = 'state/zwave/nodes/' + nodeId + '/' + valueId;
        fbSet(path, info);
        var msg = '[' + path + '] ' + JSON.stringify(info);
        log.log('[HOME] ZWave - saveNodeValue: ' + msg);
      } catch (ex) {
        log.exception('[HOME] Error in saveNodeValue', ex);
      }
    } else {
      log.error('[HOME] ZWave - no valueId for saveNodeValue');
    }
  }

  function zwaveTimerTick() {
    log.debug('[HOME] ZWave Timer Tick');
    // TODO: Check status of lights and anything else we want
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
    fbSet('state/zwave', null);
  }

  /*****************************************************************************
   *
   * Main App - Initialization & Shut Down
   *
   ****************************************************************************/

  function init() {
    log.init('[HOME] Initializing home.');
    var now = Date.now();
    var now_ = moment(now).format('YYYY-MM-DDTHH:mm:ss.SSS');
    _self.state = {
      doNotDisturb: false,
      hasNotification: false,
      systemState: 'INIT',
      time: {
        started: now,
        started_: now_,
      },
      version: version.head
    };
    fb.child('config/HomeOnNode').on('value', function(snapshot) {
      config = snapshot.val();
      log.log('[HOME] Config file updated.');
      fs.writeFile('config.json', JSON.stringify(config, null, 2));
    });
    fb.child('state').once('value', function(snapshot) {
      var previous = snapshot.val();
      if (previous) {
        if (previous.sysetmState === 'ARMED' || !previous.systemState) {
          setState('AWAY');
        } else {
          _self.state.sysetmState = previous.systemState;
        }
        if (previous.doNotDisturb === true) {
          _self.state.doNotDisturb = true;
        }
      } else {
        log.warn('[HOME] Unable to load previous state.');
        setState('AWAY');
      }
    });
    initOutsideTemp();
    initNotifications();
    initZWave();
    initNest();
    initHue();
    initHarmony();
    initPresence();
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
