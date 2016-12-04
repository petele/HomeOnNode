'use strict';

var EventEmitter = require('events').EventEmitter;
var util = require('util');
var exec = require('child_process').exec;
var log = require('./SystemLog2');
var Keys = require('./Keys').keys;
var version = require('./version');
var moment = require('moment');
var request = require('request');
var fs = require('fs');

var Firebase = require('firebase');
var Harmony = require('./Harmony');
var Hue = require('./Hue');
var Presence = require('./Presence');
var Nest = require('./Nest');
var ZWave = require('./ZWave');
var Sonos = require('./Sonos');
var GCMPush = require('./GCMPush');
var PushBullet = require('./PushBullet');

var LOG_PREFIX = 'HOME';

function Home(config, fb) {
  this.state = {};
  var _self = this;

  var nest;
  var hue;
  var harmony;
  var zwave;
  var presence;
  var sonos;
  var gcmPush;
  var pushBullet;

  var armingTimer;
  var zwaveTimer;
  var sonosTimer;
  var lastSoundPlayedAt = 0;

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
        log.error(LOG_PREFIX, 'Error retreiving light scene: ' + sceneName);
        return defaultScene;
      }
    }
    log.warn(LOG_PREFIX, 'Could not determine light scene: ' + sceneName);
    return defaultScene;
  }

  this.handleKeyEntry = function(key, modifier, sender) {
    try {
      var cmdName = config.keypad.keys[key];
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
    var msg = 'executeCommandByName: ' + commandName;
    if (modifier) {
      msg += ' (' + modifier + ')';
    }
    msg += ' received from: ' + source;
    // log.log(LOG_PREFIX, msg);
    var command = config.commands[commandName];
    if (command) {
      command.modifier = modifier;
      _self.executeCommand(command, source);
      return;
    }
    log.warn(LOG_PREFIX, 'Command (' + commandName + ') not found.');
  };

  this.executeCommand = function(command, source) {
    var modifier = command.modifier;
    var msg = 'executeCommand ';
    msg += '[' + Object.keys(command) + ']';
    if (modifier) {
      msg += ' (' + modifier + ')';
    }
    msg += ' received from: ' + source;
    log.log(LOG_PREFIX, msg);
    var cmds;
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
          scene = getLightSceneByName(cmd.receipeName);
        }
        setHueLights(cmd.lights, scene);
      });
    }
    if (command.hasOwnProperty('zWave')) {
      cmds = command.zWave;
      if (Array.isArray(cmds) === false) {
        cmds = [cmds];
      }
      cmds.forEach(function(cmd) {
        var turnOn = cmd.state;
        if (modifier === 'OFF') {
          turnOn = false;
        }
        setZWaveSwitch(cmd.id, turnOn);
      });
    }
    if (command.hasOwnProperty('nestThermostatAuto')) {
      var timeOfDay = command.nestThermostatAuto;
      if (timeOfDay === 'OFF') {
        setNestThermostatOff();
      } else {
        setNestThermostatAuto(timeOfDay);
      }
    } else if (command.hasOwnProperty('nestThermostat')) {
      cmds = command.nestThermostat;
      if (Array.isArray(cmds) === false) {
        cmds = [cmds];
      }
      cmds.forEach(function(cmd) {
        if (modifier) {
          adjustNestThermostat(cmd.roomId, modifier);
        } else {
          setNestThermostat(cmd.roomId, cmd.mode, cmd.temperature);
        }
      });
    }
    if (command.hasOwnProperty('nestETA')) {
      cmds = command.nestETA;
      if (modifier === 'OFF') {
        setNestETA(cmds.tripId, 0);
      } else {
        setNestETA(cmds.tripId, cmds.etaInMinutes);
      }
    }
    if (command.hasOwnProperty('nestFan')) {
      cmds = command.nestFan;
      if (Array.isArray(cmds) === false) {
        cmds = [cmds];
      }
      cmds.forEach(function(cmd) {
        setNestFan(cmd, modifier);
      });
    }
    if (command.hasOwnProperty('harmonyActivity')) {
      setHarmonyActivity(command.harmonyActivity);
    }
    if (command.hasOwnProperty('harmonyKey')) {
      sendHarmonyKey(command.harmonyKey);
    }
    if (command.hasOwnProperty('refreshHarmonyConfig')) {
      refreshHarmonyConfig();
    }
    if (command.hasOwnProperty('nestCam')) {
      var enabled = command.nestCam;
      if (modifier === 'OFF') {
        enabled = 'OFF';
      }
      enableNestCam(enabled);
    }
    if (command.hasOwnProperty('sonos')) {
      if (sonos) {
        cmds = command.sonos;
        if (Array.isArray(cmds) === false) {
          cmds = [cmds];
        }
        cmds.forEach(function(cmd) {
          var roomName = cmd.roomName;
          if (!roomName) {
            roomName = _self.state.sonos.state.roomName;
          }
          if (cmd.name === 'PRESET') {
            var opts = config.sonosPresetOptions[cmd.options];
            opts.uri = cmd.uri;
            sonos.applyPreset(opts);
          } else if (cmd.name === 'PAUSE') {
            sonos.pause(roomName);
          } else if (cmd.name === 'NEXT') {
            sonos.next(roomName);
          } else if (cmd.name === 'PLAY') {
            sonos.play(roomName);
          } else if (cmd.name === 'PREVIOUS') {
            sonos.previous(roomName);
          } else if (cmd.name === 'VOLUME_DOWN') {
            sonos.volumeDown(roomName);
          } else if (cmd.name === 'VOLUME_UP') {
            sonos.volumeUp(roomName);
          } else {
            log.warn('[HOME] Unknown Sonos command: ' + JSON.stringify(cmd));
          }
        });
      } else {
        log.error('[HOME] Sonos command failed, Sonos unavailable.');
      }
    }
    if (command.hasOwnProperty('sendNotification')) {
      if (gcmPush) {
        gcmPush.sendMessage(command.sendNotification);
      }
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
    if (command.hasOwnProperty('state')) {
      setState(command.state);
    }
  };

  this.ringDoorbell = function(source) {
    log.log(LOG_PREFIX, 'Doorbell');
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
        log.info(LOG_PREFIX, 'Door debouncer, door already ' + doorState);
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
    log.log(LOG_PREFIX, doorName + ' ' + doorState);
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
    log.debug(LOG_PREFIX, 'setDoNotDisturb: ' + val);
    if (val === 'ON') {
      fbSet('state/doNotDisturb', true);
      return true;
    }
    fbSet('state/doNotDisturb', false);
    return true;
  }

  function setState(newState) {
    log.debug(LOG_PREFIX, 'setState: ' + newState);
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
      log.warn(LOG_PREFIX, 'State already set to ' + newState);
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
    var now = Date.now();
    if (now - lastSoundPlayedAt > 15000 && force !== true) {
      log.debug(LOG_PREFIX, 'playSound skipped, too soon.');
      return;
    }
    lastSoundPlayedAt = now;
    log.debug(LOG_PREFIX, 'playSound: ' + file + ' ' + force);
    if (_self.state.doNotDisturb === false || force === true) {
      setTimeout(function() {
        var cmd = 'mplayer ';
        cmd += file;
        exec(cmd, function(error, stdout, stderr) {
          if (error) {
            log.exception(LOG_PREFIX, 'PlaySound Error', error);
          }
        });
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
          log.exception(LOG_PREFIX, 'Unable to push data to Firebase. (CB)', err);
        }
      });
      fbSetLastUpdated();
    } catch (ex) {
      log.exception(LOG_PREFIX, 'Unable to PUSH data to Firebase. (TC)', ex);
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
            log.exception(LOG_PREFIX, 'Set data failed on path: ' + path, err);
          }
        });
      }
      fbSetLastUpdated();
    } catch (ex) {
      log.exception(LOG_PREFIX, 'Unable to set data on path: ' + path, ex);
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
    // log.debug(LOG_PREFIX, 'Updating weather.');
    if (config.weatherLatLong && Keys.forecastIO && Keys.forecastIO.key) {
      var url = 'https://api.forecast.io/forecast/';
      url += Keys.forecastIO.key + '/';
      url += config.weatherLatLong;
      request(url, function(error, response, body) {
        if (error || !response || response.statusCode !== 200) {
          var msg = 'Forecast.IO API - ';
          if (error) {
            log.exception(LOG_PREFIX, msg + 'Error', error);
            return;
          } else if (!response) {
            log.error(LOG_PREFIX, msg + 'No response!');
            return;
          } else if (response.statusCode !== 200) {
            log.error(LOG_PREFIX, msg + 'Returned statusCode: ' + response.statusCode);
            log.debug('Response: ' + body);
            return;
          }
          log.exception(LOG_PREFIX, msg + 'Unknown Error');
          return;
        }
        var forecast;
        try {
          forecast = JSON.parse(body);
        } catch (ex) {
          log.exception(LOG_PREFIX, 'Unable to parse weather response', ex);
          return;
        }
        if (forecast) {
          if (forecast.currently) {
            fbSet('state/weather/now', forecast.currently);
          } else {
            log.error(LOG_PREFIX, 'Could not find current forecast.');
          }
          if (forecast.daily && forecast.daily.data[0]) {
            fbSet('state/weather/today', forecast.daily.data[0]);
          } else {
            log.error(LOG_PREFIX, 'Could not find daily forecast.');
          }
        } else {
          log.error(LOG_PREFIX, 'Could not find forecast!');
        }
      });
    } else {
      log.warn(LOG_PREFIX, 'Missing key, expected Lat/Lon & API Key');
    }
    var interval = 5 * 60 * 1000;
    setTimeout(initWeather, interval);
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
      log.exception(LOG_PREFIX, 'Unable to initialize Presence', ex);
      shutdownPresence();
      return;
    }

    if (presence) {
      presence.on('adapterError', shutdownPresence);
      presence.on('presence_unavailable', shutdownPresence);
      presence.on('error', function(err) {
        log.exception(LOG_PREFIX, 'Presence error', err);
      });
      var fbPresFlicPath = 'config/HomeOnNode/presence/FlicAway';
      fb.child(fbPresFlicPath).on('value', function(snapshot) {
        if (presence) {
          presence.setFlicAway(snapshot.val());
        } else {
          log.error(LOG_PREFIX, 'Away button disabled, no presence detected.');
        }
      });
      presence.on('flic_away', function() {
        _self.executeCommand({state: 'ARMED'}, 'Flic');
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
    log.log(LOG_PREFIX, 'Shutting down Presence.');
    try {
      presence.shutdown();
    } catch (ex) {
      log.warn(LOG_PREFIX, 'Error attempting to shut down Presence.');
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
      log.exception(LOG_PREFIX, 'Unable to initialize Harmony', ex);
      resetHarmony();
      return;
    }

    if (harmony) {
      harmony.on('ready', function(config) {
        fbSet('state/harmonyConfig', config);
      });
      harmony.on('activity', updateHarmonyActivity);
      harmony.on('connection_failed', resetHarmony);
      harmony.on('hub_search_failed', resetHarmony);
      harmony.on('no_hubs_found', resetHarmony);
      harmony.on('socket_error', function(err) {});
      harmony.on('error', function(err) {});
      harmony.on('no_client', resetHarmony);
    }
  }

  function resetHarmony() {
    log.log(LOG_PREFIX, 'Harmony failed, will attempt reconnect in 90 seconds.');
    shutdownHarmony();
    setTimeout(function() {
      log.log(LOG_PREFIX, 'Attempting to reconnect to Harmony.');
      initHarmony();
    }, 90 * 1000);
  }

  function updateHarmonyActivity(newActivity) {
    log.log(LOG_PREFIX, 'Harmony activity is: ' + JSON.stringify(newActivity));
    fbSet('state/harmony', newActivity);
    if (_self.state.harmonyConfig && _self.state.harmonyConfig.activity) {
      var activityPath = 'state/harmonyConfig/activity/[I]/isOn';
      var activities = _self.state.harmonyConfig.activity;
      activities.forEach(function(activity, i) {
        var isOn = false;
        if (activity.id === newActivity.id) {
          isOn = false;
        }
        fbSet(activityPath.replace('[I]', i), isOn);
      });
    }
  }

  function shutdownHarmony() {
    log.log(LOG_PREFIX, 'Shutting down Harmony.');
    try {
      if (harmony) {
        harmony.close();
      }
    } catch (ex) {
      log.warn(LOG_PREFIX, 'Error attempting to shut down Harmony.', ex);
    }
    harmony = null;
  }

  function refreshHarmonyConfig() {
    if (harmony) {
      try {
        harmony.getConfig();
        return true;
      } catch (ex) {
        log.exception(LOG_PREFIX, 'Harmony refreshHarmonyConfig failed.', ex);
        return false;
      }
    }
    log.warn(LOG_PREFIX, 'refreshHarmonyConfig failed, Harmony not ready');
    return false;
  }

  function setHarmonyActivity(activityName) {
    if (harmony) {
      try {
        harmony.setActivityByName(activityName);
        return true;
      } catch (ex) {
        log.exception(LOG_PREFIX, 'Harmony activity failed', ex);
        return false;
      }
    }
    log.warn(LOG_PREFIX, 'Harmony activity failed, Harmony not ready.');
    return false;
  }

  function sendHarmonyKey(harmonyKey) {
    if (harmony) {
      try {
        harmony.sendCommand(harmonyKey);
        return true;
      } catch (ex) {
        log.exception(LOG_PREFIX, 'Harmony command failed', ex);
        return false;
      }
    }
    log.warn(LOG_PREFIX, 'Harmony command failed, Harmony not ready.');
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
    } catch (ex) {
      log.exception(LOG_PREFIX, 'Unable to initialize Nest', ex);
      shutdownNest();
      return;
    }

    if (nest) {
      nest.login(Keys.nest.token);
      nest.on('error', function(err) {
        log.exception(LOG_PREFIX, 'Nest CRITICAL error occured.', err);
      });
      nest.on('authError', function(err) {
        log.exception(LOG_PREFIX, 'Nest auth error occured.', err);
        shutdownNest();
      });
      nest.on('change', function(data) {
        fbSet('state/nest', data);
      });
      nest.on('alarm', function(kind, protect) {
        var msg = 'Nest Alarm - ';
        msg += 'kind: ' + JSON.stringify(kind);
        msg += 'protect: ' + JSON.stringify(protect);
        log.warn(LOG_PREFIX, msg);
        _self.executeCommandByName('NEST_ALARM', null, 'NEST_ALARM');
      });
      nest.on('ready', function(data) {
        nest.enableListener();
      });
      nest.on('connectionCycle', function() {
        var msg = {
          title: 'HoN Nest Error',
          body: 'The Nest connection has been cycling',
          tag: 'HoN-nest-cycle',
          appendTime: false
        };
        gcmPush.sendMessage(msg);
      });
    }
  }

  function shutdownNest() {
    log.log(LOG_PREFIX, 'Shutting down Nest.');
    nest = null;
  }

  function enableNestCam(enabled) {
    if (nest) {
      try {
        if (enabled === 'ON') {
          nest.enableCamera();
          return true;
        }
        nest.disableCamera();
        return true;
      } catch (ex) {
        log.exception(LOG_PREFIX, 'Failed to update NestCam', ex);
        return false;
      }
    }
    log.warn(LOG_PREFIX, 'NestCam command failed, Nest not ready.');
    return false;
  }

  function setNestETA(tripId, etaInMinutes) {
    if (nest) {
      try {
        var etaBegin;
        var etaEnd;
        if (etaInMinutes === 0) {
          etaBegin = 0;
          etaEnd = 0;
        } else {
          etaBegin = moment().add(etaInMinutes, 'm').toISOString();
          etaEnd = moment().add(etaInMinutes, 'm').add(30, 'm').toISOString();
        }
        if (!tripId) {
          tripId = 'defaultTripName';
        }
        nest.setETA(tripId, etaBegin, etaEnd);
        fbSet('state/nestETA', etaBegin);
        return true;
      } catch (ex) {
        log.exception(LOG_PREFIX, 'Error setting Nest ETA', ex);
        return false;
      }
    }
    log.warn(LOG_PREFIX, 'Unable to set Nest ETA, Nest not ready.');
    return false;
  }

  function getNestThermostatId(roomId) {
    var msg = 'getNestThermostatId failed, ';
    try {
      var id = config.hvac.thermostats[roomId];
      if (id) {
        return id;
      }
      log.error(LOG_PREFIX, msg + 'roomId (' + roomId + ') not found.');
    } catch (ex) {
      log.exception(LOG_PREFIX, msg, ex);
      return null;
    }
  }

  function adjustNestThermostat(roomId, modifier) {
    var msg = 'adjustNestThermostat ' + roomId + ': ' + modifier;
    if (nest) {
      try {
        var id = getNestThermostatId(roomId);
        if (id) {
          msg += ' (' + id + ')';
          var thermostat = _self.state.nest.devices.thermostats[id];
          /* jshint -W106 */
          // jscs:disable requireCamelCaseOrUpperCaseIdentifiers
          var mode = thermostat.hvac_mode;
          var temperature = thermostat.target_temperature_f;
          // jscs:enable
          /* jshint +W106 */
          msg += ' from: ' + mode + ' ' + temperature + 'F ';
          if (modifier === 'UP' || modifier === 'DIM_UP') {
            temperature = temperature + 1;
          } else if (modifier === 'DOWN' || modifier === 'DIM_DOWN') {
            temperature = temperature - 1;
          } else if (modifier === 'OFF') {
            mode = 'off';
          }
          msg += 'to: ' + mode + ' ' + temperature + 'F';
          log.debug(LOG_PREFIX, msg);
          return nest.setTemperature(id, mode, temperature);
        }
        msg += ' failed. Thermostat not found.';
        log.error(LOG_PREFIX, msg);
        return false;
      } catch (ex) {
        msg += ' failed with exception.';
        log.exception(LOG_PREFIX, msg, ex);
        return false;
      }
    }
    log.log(LOG_PREFIX, 'adjustNestThermostat failed, Nest unavailable.');
    return false;
  }

  function setNestThermostat(roomId, mode, temperature) {
    var msg = 'setNestThermostat failed, ';
    if (nest) {
      try {
        var id = getNestThermostatId(roomId);
        if (id) {
          if (mode && temperature) {
            return nest.setTemperature(id, mode, temperature);
          } else {
            log.error(LOG_PREFIX, msg + 'invalid mode or temperature');
            return false;
          }
        }
        log.error(LOG_PREFIX, msg + 'thermostat not found');
        return false;
      } catch (ex) {
        log.exception(LOG_PREFIX, msg, ex);
        return false;
      }
    }
    log.log(LOG_PREFIX, msg + 'Nest unavailable.');
    return false;
  }

  function setNestFan(cmd, modifier) {
    var msg ='setNestFan failed, ';
    if (nest) {
      try {
        var minutes = parseInt(cmd.minutes, 10);
        if (modifier === 'OFF') {
          minutes = 0;
        }
        var id = getNestThermostatId(cmd.roomId);
        if (id) {
          return nest.runNestFan(id, minutes);
        }
        log.error(LOG_PREFIX, msg + 'thermostat not found');
        return false;
      } catch (ex) {
        log.exception(LOG_PREFIX, msg, ex);
        return false;
      }
    }
    log.warn(LOG_PREFIX, msg + 'Nest unavailable.');
    return false;
  }

  function setNestThermostatAuto(timeOfDay) {
    var msg = 'setNestThermostatAuto failed, ';
    var hvacMode = config.hvac.defaultMode;
    var hvacCmd = timeOfDay + '_' + hvacMode;
    hvacCmd = hvacCmd.toUpperCase();
    var rooms = config.hvac.auto[hvacCmd];
    if (!rooms) {
      log.error(LOG_PREFIX, msg + 'Params failed: ' + hvacCmd);
      return false;
    }
    if (!nest) {
      log.error(LOG_PREFIX, msg + 'Nest not ready.');
      return false;
    }
    var keys = Object.keys(rooms);
    keys.forEach(function(key) {
      var temperature = rooms[key];
      var thermostatId = config.hvac.thermostats[key];
      if (temperature && thermostatId) {
        nest.setTemperature(thermostatId, hvacMode, temperature);
      }
    });
    return true;
  }

  function setNestThermostatOff() {
    if (!nest) {
      var msg = 'setNestThermostatOff failed, ';
      log.error(LOG_PREFIX, msg + 'Nest not ready.');
      return false;
    }
    var keys = Object.keys(config.hvac.thermostats);
    keys.forEach(function(key) {
      var thermostatId = config.hvac.thermostats[key];
      nest.setTemperature(thermostatId, 'off', 70);
    });
    return true;
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

  /*****************************************************************************
   *
   * PushBullet - Initialization, Shut Down & Event handlers
   *
   ****************************************************************************/

  function initPushBullet() {
    try {
      pushBullet = new PushBullet(Keys.pushBullet);
    } catch (ex) {
      log.exception(LOG_PREFIX, 'Unable to initialize PushBullet', ex);
      return;
    }

    if (pushBullet) {
      pushBullet.on('notification', function(msg, count) {
        try {
          var cmdName;
          if (msg.application_name) {
            cmdName = config.pushBulletNotifications[msg.application_name];
          }
          if (cmdName) {
            _self.executeCommandByName(cmdName, null, 'PushBullet');
          } else {
            // var logObj = {
            //   appName: msg.application_name,
            //   pkgName: msg.package_name,
            //   dismissible: msg.dismissible
            // };
            // if (msg.title) { logObj.title = msg.title; }
            // if (msg.body) { logObj.body = msg.body; }
            // fbPush('logs/pushBullet', logObj);            
          }
        } catch (ex) {
          var logMsg = 'PushBullet notification commandName lookup failure.';
          log.exception(LOG_PREFIX, logMsg, ex);
        }
      });
      pushBullet.on('dismissal', function(msg, count) {
        if (count === 0) {
          var cmdName = config.pushBulletNotifications['-NONE'];
          if (cmdName) {
            _self.executeCommandByName(cmdName, null, 'PushBullet');
          }
        }
      });
    }
  }

  function shutdownPushBullet() {
    if (pushBullet) {
      pushBullet.shutdown();
    }
  }

  /*****************************************************************************
   *
   * Sonos - Initialization & Shut Down
   *
   ****************************************************************************/

  function initSonos() {
    try {
      sonos = new Sonos();
    } catch (ex) {
      log.exception(LOG_PREFIX, 'Unable to initialize Sonos', ex);
      if (sonos) {
        sonos.shutdown();
      }
      return;
    }

    if (sonos) {
      sonos.on('transport-state', function(transportState) {
        fbSet('state/sonos/state', transportState);
      });
      sonos.on('topology-changed', function(zones) {
        fbSet('state/sonos/zones', zones);
      });
      sonos.on('favorites-changed', function(favorites) {
        fbSet('state/sonos/favorites', favorites);
      });
      setTimeout(getSonosFavorites, 120*1000);
    }
  }

  function getSonosFavorites() {
    if (sonos) {
      sonos.getFavorites();
    }
    setTimeout(getSonosFavorites, 5*60*1000);
  }

  function shutdownSonos() {
    if (sonosTimer) {
      clearInterval(sonosTimer);
      sonosTimer = null;
    }
    if (sonos) {
      sonos.shutdown();
    }
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
        // zwaveTimer = setInterval(zwaveTimerTick, 30000);
      });
      zwave.on('node_event', zwaveEvent);
      zwave.on('node_value_change', zwaveSaveNodeValue);
      zwave.on('node_value_refresh', zwaveSaveNodeValue);
      zwave.on('node_value_removed', function(nodeId, info) {
        var msg = '[' + nodeId + '] ' + JSON.stringify(info);
        log.warn(LOG_PREFIX, 'ZWave - nodeValueRemoved: ' + msg);
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
        // Only fire motion events when system is in AWAY mode
        if (_self.state.systemState !== 'HOME') {
          var cmdName = 'MOTION_' + deviceName;
          _self.executeCommandByName(cmdName, null, deviceName);
        }
      } else {
        log.warn(LOG_PREFIX, 'Unknown ZWave device kind: ' + nodeId);
      }
    } else {
      log.warn(LOG_PREFIX, 'Unhandled ZWave Event:' + nodeId + ':' + value);
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
      } catch (ex) {
        log.exception(LOG_PREFIX, 'Error in saveNodeValue', ex);
      }
    } else {
      log.error(LOG_PREFIX, 'ZWave - no valueId for saveNodeValue');
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

  function setZWaveSwitch(id, newState) {
    if (zwave) {
      try {
        zwave.setNodeBinary(id, newState);
        return true;
      } catch (ex) {
        log.exception(LOG_PREFIX, 'ZWave Switch change failed.', ex);
        return false;
      }
    }
    log.warn(LOG_PREFIX, 'ZWave switch failed, ZWave not ready.');
    return false;
  }

  /*****************************************************************************
   *
   * Main App - Initialization & Shut Down
   *
   ****************************************************************************/

  function init() {
    log.init(LOG_PREFIX, 'Initializing home.');
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
      log.log(LOG_PREFIX, 'Config file updated.');
      fs.writeFile('config.json', JSON.stringify(config, null, 2));
    });
    gcmPush = new GCMPush(fb);
    initNotifications();
    initZWave();
    initNest();
    initHue();
    initSonos();
    initHarmony();
    initPresence();
    initPushBullet();
    initWeather();
    setTimeout(function() {
      log.log(LOG_PREFIX, 'Ready');
      _self.emit('ready');
    }, 750);
    playSound(config.readySound);
  }

  this.shutdown = function() {
    shutdownHue();
    shutdownNest();
    shutdownSonos();
    shutdownZWave();
    shutdownHarmony();
    shutdownPresence();
    shutdownPushBullet();
  };

  init();
}

util.inherits(Home, EventEmitter);

module.exports = Home;
