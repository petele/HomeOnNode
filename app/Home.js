'use strict';

var EventEmitter = require('events').EventEmitter;
var util = require('util');
var exec = require('child_process').exec;
var log = require('./SystemLog');
var Keys = require('./Keys').keys;
var version = require('./version');
var moment = require('moment');
var fs = require('fs');

var InsideTemperature = require('./InsideTemperature');
var Firebase = require('firebase');
var AirConditioner = require('./AirConditioner');
var Harmony = require('./Harmony');
var Hue = require('./Hue');
var Dropcam = require('./Dropcam');
var Presence = require('./Presence');
var Nest = require('./Nest');

function Home(config, fb) {
  this.state = {};
  var _self = this;

  var armingTimer;
  var nest;
  var nestIsReady = false;
  var dropcam;
  var dropcamIsReady = false;
  var insideTemp;
  var hue;
  var hueIsReady = false;
  var harmony;
  var harmonyIsReady = false;
  var hvac;
  var presence;

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
    var result;
    var defaultScene = {bri: 254, ct: 369, on: true};
    try {
      if (sceneName.toUpperCase() === 'OFF') {
        result = {on: false};
      } else if (sceneName.toUpperCase() === 'ON') {
        result = {on: true};
      } else {
        result = config.lightScenes[sceneName];
      }
      if (result === undefined || result === null) {
        log.error('[HOME] Unable to find light scene: ' + sceneName);
        result = defaultScene;
      }
    } catch (ex) {
      log.exception('[HOME] Error getting light scene:' + sceneName, ex);
      result = defaultScene;
    }
    return result;
  }

  this.executeCommand = function(commandName, modifier, source) {
    var result = {};
    var msg = '[HOME] Command received: ' + commandName + ' [' + modifier + ']';
    msg += ' from ' + source;
    log.log(msg);
    var command = getCommandByName(commandName);
    if (command.state) {
      setState(command.state);
    }
    if (command.hue) {
      if (hueIsReady) {
        result.hue = [];
        command.hue.forEach(function(cmd) {
          var scene;
          if (modifier) {
            if (modifier === 'UP') {
              scene = {'bri_inc': 20};
            } else if (modifier === 'DOWN') {
              scene = {'bri_inc': -20};
            } else if (modifier === 'OFF') {
              scene = {on: false};
            } else {
              scene = getLightSceneByName(modifier);
            }
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
        msg = '[HOME] Hue command failed, Hue not ready.';
        log.warn(msg);
        result.hue = msg;
      }
    }
    if (command.nest) {
      if (nestIsReady) {
        try {

        } catch (ex) {
          log.exception('[HOME] Nest command failed', ex);
        }
      } else {
        msg = '[HOME] Nest command failed, Nest not ready.';
        log.warn(msg);
        result.nest = msg;
      }
    }
    if (command.dropcam) {
      if (dropcamIsReady) {
        var enabled = true;
        if ((modifier === 'OFF') || (command.dropcam.all === false)) {
          enabled = false;
        }
        try {
          dropcam.enableCameras(enabled);
          result.dropcam = enabled;
        } catch (ex) {
          log.exception('[HOME] Dropcam change failed', ex);
          result.dropcam = ex;
        }
      } else {
        msg = '[HOME] Dropcam change failed, Dropcam not ready.';
        log.warn(msg);
        result.dropcam = msg;
      }
    }
    if (command.hvac) {
      try {
        command.hvac.forEach(function(roomCmd) {
          var room = roomCmd.room;
          var mode = roomCmd.mode || 'auto';
          var temp;
          if (modifier === 'UP') {
            temp = 1;
          } else if (modifier === 'DOWN') {
            temp = -1;
          } else if (modifier === 'OFF') {
            temp = 0;
            mode = 'off';
          } else {
            temp = parseInt(roomCmd.temperature);
          }
          _self.setTemperature(room, mode, temp, source);
        });
      } catch (ex) {
        log.exception('[HOME] HVAC Exception', ex);
      }
    }
    if (command.harmony) {
      if (harmonyIsReady) {
        try {
          harmony.setActivityByName(command.harmony);
        } catch (ex) {
          log.exception('[HOME] Harmony activity failed', ex);
        }
      } else {
        log.warn('[HOME] Harmony activity failed, Harmony not ready.');
      }
    }
    if (command.sound) {
      playSound(command.sound);
    }
    if (command.doNotDisturb) {
      var val = command.doNotDisturb.enabled || false;
      if (modifier === 'OFF') {
        val = false;
      }
      _self.state.doNotDisturb = val;
      fbSet('state/doNotDisturb', val);
      log.debug('[HOME] Do Not Disturb set to: ' + val);
      result.doNotDisturb = val;
    }
    return result;
  };

  //Updated
  this.setTemperature = function(room, mode, temperature, sender) {
    var result;
    var currentTemp = _self.state.hvac[room].temperature;
    if (temperature === 1) {
      temperature = currentTemp + 1;
    } else if (temperature === -1) {
      temperature = currentTemp - 1;
    }
    if (hvac) {
      log.log('[HOME] AC in ' + room + ' set to ' + temperature + ' ' + mode);
      result = hvac[room].setTemperature(temperature, mode);
      _self.state.hvac[room].temperature = result.temperature;
      _self.state.hvac[room].mode = result.mode;
      fbSet('state/hvac/' + room + '/temperature', result.temperature);
      fbSet('state/hvac/' + room + '/mode', result.mode);
    }
    return result;
  };

  //Updated
  this.entryDoor = function(doorName, doorState, source) {
    var result = {};
    if (_self.state.systemState === 'AWAY' && doorState === 'OPEN') {
      result = _self.executeCommand('ENTRY_DOOR', null, source);
    }
    fbSet('state/doors/' + doorName, doorState);
    var now = Date.now();
    var doorLogObj = {
      doorName: doorName,
      state: doorState,
      source: source,
      date: now,
      date_: moment(now).format('YYYY-MM-DDTHH:mm:ss.SSS')
    };
    fbPush('logs/doors', doorLogObj);
    log.log('[HOME] ' + doorName + ' ' + doorState);
    return result;
  };

  this.hueCommand = function(cmd) {
    // TODO: Add hue commands
    log.todo('[HOME] Hue API Access not yet implemented.');
  };

  //Updated
  this.shutdown = function() {
    if (harmonyIsReady) {
      try {
        harmony.close();
      } catch (ex) {
        log.debug('[HOME] Error shutting down Harmony command.');
      }
    }
  };

  //Updated
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

  //Updated
  function fbSet(path, value) {
    var fbObj = fb;
    if (path) {
      fbObj = fb.child(path);
    }
    try {
      fbObj.set(value);
      var now = Date.now();
      fb.child('state/time').update({
        lastUpdated: now,
        lastUpdated_: moment(now).format('YYYY-MM-DDTHH:mm:ss.SSS')
      });
      _self.state.time.lastUpdated = now;
    } catch (ex) {
      log.exception('[HOME] Unable to SET data to firebase.', ex);
    }
  }

  //Updated
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
    log.log('[HOME] State changed to: ' + newState);
    fbSet('state/systemState', newState);
    fbPush('logs/systemState', {'date': Date.now(), 'state': newState});
    var cmd = 'RUN_ON_' + newState;
    if (newState === 'AWAY' || newState === 'ARMED') {
      if (nestIsReady) {
        nest.setAway();
      }
    } else {
      if (nestIsReady) {
        nest.setHome();
      }
    }
    _self.executeCommand(cmd);
    return newState;
  }

  //Updated
  function playSound(file) {
    if (_self.state.doNotDisturb === false) {
      setTimeout(function() {
        var cmd = 'mplayer -ao alsa -really-quiet -noconsolecontrols ';
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

  //Updated
  function initInsideTemp() {
    insideTemp = new InsideTemperature(90000);
    _self.state.temperature = _self.state.temperature || {};
    insideTemp.on('error', function(error) {
      _self.state.temperature.inside = 0;
      fbSet('state/temperature/inside', null);
      log.exception('[HOME] Error reading inside temperature', error);
      insideTemp = null;
      setTimeout(function() {
        initInsideTemp();
      }, 90000);
    });
    insideTemp.on('change', function(data) {
      var val = parseFloat(data.f).toFixed(2);
      _self.state.temperature.inside = val;
      fbSet('state/temperature/inside', val);
      log.debug('[HOME] Inside temperature is ' + val + 'F');
    });
  }

  //Updated
  function initOutsideTemp() {
    _self.state.temperature = _self.state.temperature || {};
    var url = 'https://publicdata-weather.firebaseio.com/';
    url += config.fbWeatherCity;
    var weatherRef = new Firebase(url);
    weatherRef.child('currently/temperature').on('value', function(snapshot) {
      var temp = snapshot.val();
      _self.state.temperature.outside = temp;
      fbSet('state/temperature/outside', temp);
      log.debug('[HOME] Outside temperature is ' + temp + 'F');
    });
    weatherRef.child('daily/data/0').on('value', function(snapshot) {
      var snap = snapshot.val();
      _self.state.time.sunrise = snap.sunriseTime * 1000;
      _self.state.time.sunset = snap.sunsetTime * 1000;
      var sunrise_ = moment(snap.sunriseTime * 1000).format();
      var sunset_ = moment(snap.sunsetTime * 1000).format();
      fbSet('state/time/sunrise', _self.state.time.sunrise);
      fbSet('state/time/sunrise_', sunrise_);
      fbSet('state/time/sunset', _self.state.time.sunset);
      fbSet('state/time/sunset_', sunset_);
      log.debug('[HOME] Sunrise is at ' + sunrise_);
      log.debug('[HOME] Sunset is at ' + sunset_);
    });
  }

  function initHVAC() {
    var itachIP = '192.168.1.211';
    hvac = {};
    _self.state.hvac = {};
    config.hvac.rooms.forEach(function(room) {
      if (room.itach) {
        var irPort = room.itach.port;
        var cmds = config.hvac.itachCommands[room.itach.protocol];
        hvac[room.id] = new AirConditioner(room.id, itachIP, irPort, cmds);
      }
      room.temperature = 0;
      room.mode = 'off';
      _self.state.hvac[room.id] = room;
      fbSet('state/hvac/' + room.id, room);
    });
  }

  function initPresence() {
    presence = new Presence();
    presence.on('error', function(err) {
      log.debug('[HOME] Presence error, whoops!');
    });
    presence.on('change', function(person, present) {
      fbPush('logs/presence', person);
      var cmd = 'PRESENCE_SOME';
      if (present === 0) {
        cmd = 'PRESENCE_NONE';
      }
      _self.executeCommand(cmd, null, 'PRESENCE');
    });
    var fbPresPath = 'config/presence/people';
    fb.child(fbPresPath).on('child_added', function(snapshot) {
      console.log('PPP - added', snapshot.val());
    });
    fb.child(fbPresPath).on('child_removed', function(snapshot) {
      console.log('PPP - removed', snapshot.val());
    });
    fb.child(fbPresPath).on('child_changed', function(snapshot) {
      console.log('PPP - changed', snapshot.val());
    });
  }

  //Updated
  function initHarmony() {
    _self.state.harmony = {};
    harmony = new Harmony(Keys.harmony.key);
    harmony.on('ready', function(config) {
      harmonyIsReady = true;
    });
    harmony.on('activity', function(activity) {
      _self.state.harmony = activity;
      fbSet('state/harmony', activity);
      log.log('[HOME] Harmony activity is: ' + JSON.stringify(activity));
    });
    harmony.on('error', function() {
      log.error('[HOME] Harmony error occured, will reattempt in 90 seconds.');
      harmonyIsReady = false;
      harmony.close();
      harmony = null;
      setTimeout(function() {
        initHarmony();
      }, 90000);
    });
  }

  //Updated
  function initNest() {
    nest = new Nest();
    nest.login(Keys.nest.token);
    nest.on('authError', function(err) {
      nestIsReady = false;
      nest = null;
      log.error('[HOME] Nest Auth error occured, retrying in 90 seconds');
      setTimeout(function() {
        initNest();
      }, 90000);
    });
    nest.on('change', function(data) {
      log.debug('[HOME] Nest changed');
      _self.state.nest = data;
      fbSet('state/nest', data);
    });
    nest.on('alarm', function(kind, protect) {
      _self.executeCommand('NEST_ALARM', null, 'NEST-' + protect);
    });
    nest.on('ready', function(data) {
      nestIsReady = true;
      nest.enableListener();
    });
  }

  //Updated
  function initDropcam() {
    _self.state.dropcam = {};
    dropcam = new Dropcam(Keys.nest.user, Keys.nest.password);
    dropcam.on('authError', function(err) {
      log.error('[HOME] Dropcam error occured, will reattempt in 90 seconds.');
      dropcam = null;
      dropcamIsReady = false;
      setTimeout(function() {
        initDropcam();
      }, 90000);
    });
    dropcam.on('error', function(err) {
      log.error('[HOME] Dropcam Error received: ' + JSON.stringify(err));
    });
    dropcam.on('ready', function(cameras) {
      _self.state.dropcam = cameras;
      fbSet('state/dropcam', cameras);
      dropcamIsReady = true;
    });
    dropcam.on('change', function(cameras) {
      log.debug('[HOME] Dropcam changed');
      _self.state.dropcam = cameras;
      fbSet('state/dropcam', cameras);
    });
  }

  //Updated
  function initHue() {
    hue = new Hue(Keys.hueBridge.key);
    hue.on('change', function(lights, groups) {
      _self.state.hue.lights = lights;
      fbSet('state/hue/lights', lights);
      _self.state.hue.groups = groups;
      fbSet('state/hue/groups', groups);
    });
    hue.on('ready', function() {
      _self.state.hue = {
        lights: false,
        groups: false
      };
      hueIsReady = true;
    });
    hue.on('error', function() {
      log.error('[HOME] Hue error occured, will reattempt in 90 seconds.');
      hueIsReady = false;
      hue = null;
      _self.state.hue.lights = false;
      fbSet('state/hue/lights', false);
      _self.state.hue.groups = false;
      fbSet('state/hue/groups', false);
      setTimeout(function() {
        initHue();
      }, 90000);
    });
  }

  //Updated
  function initNotifications() {
    fb.child('state/hasNotification').on('value', function(snapshot) {
      if (snapshot.val() === true) {
        if (_self.state.systemState === 'HOME') {
          _self.executeCommand('NEW_NOTIFICATION');
        }
        log.log('[HOME] New notification received.');
        snapshot.ref().set(false);
      }
    });
  }

  function init() {
    log.init('[HOME] Initializing home.');
    fbSet('state', 'STARTING');
    _self.state.systemState = 'STARTING';
    var now = Date.now();
    var now_ = moment(now).format('YYYY-MM-DDTHH:mm:ss.SSS');
    _self.state = {
      doNotDisturb: {enabled: false},
      dropcam: false,
      hvac: false,
      nest: false,
      systemState: 'INIT',
      temperature: false,
      time: {
        started: now,
        started_: now_,
      },
      version: version.head
    };
    fb.child('config').on('value', function(snapshot) {
      config = snapshot.val();
      log.log('[HOME] Config file updated.');
      fs.writeFile('config.json', JSON.stringify(config, null, 2));
    });
    fb.child('state/systemState').once('value', function(snapshot) {
      var newState;
      try {
        newState = snapshot.val();
      } catch (ex) {
        log.exception('[HOME] Unable to read state.', ex);
        newState = null;
      }
      if (newState === 'HOME' || newState === 'AWAY') {
        log.log('[HOME] Set state based on previous setting: ' + newState);
        _self.state.systemState = newState;
      } else {
        log.log('[HOME] Previous state unavailable: ' + newState);
        setState('AWAY');
      }
    }, function(err) {
      log.exception('[HOME] Unable to retreive previous state.', err);
      setState('AWAY');
    });
    if (config.features.insideTemp === true) {
      initInsideTemp();
    }
    initOutsideTemp();
    initNotifications();
    initHVAC();
    if (config.features.nest === true) {
      initNest();
    }
    if (config.features.dropcam === true) {
      initDropcam();
    }
    if (config.features.hue === true) {
      initHue();
    }
    if (config.features.harmony === true) {
      initHarmony();
    }
    // TODO finish setting up presence!
    log.todo('[HOME] Set up presence!');
    if (config.features.presence === true) {
      initPresence();
    }
    setTimeout(function() {
      log.log('[HOME] Ready');
      _self.emit('ready');
    }, 750);
    playSound(config.readySound);
  }

  init();
}

util.inherits(Home, EventEmitter);

module.exports = Home;
