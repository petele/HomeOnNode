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

function Home(config, fb) {
  this.state = {};
  var _self = this;

  var armingTimer;
  var nest;
  var nestIsReady = false;
  var hue;
  var hueIsReady = false;
  var harmony;
  var harmonyIsReady = false;
  var zwave;
  var zwaveIsReady = false;
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

  this.handleKeyEntry = function(key, modifier, sender) {
    try {
      var cmdName = config.keypad.keys[key];
      if (cmdName) {
        _self.executeCommand(cmdName, modifier, sender);
      } else {
        log.warn('[HOME] Unknown key pressed: ' + key);
      }
    } catch (ex) {
      log.exception('[HOME] Error handling key entry.', ex);
    }
  };

  // TODO refactor to executeCommand and executeCommandByName
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
    if (command.zwave) {
      log.todo('[HOME] execute ZWave Command is NYI.');
      if (zwaveIsReady) {

      } else {
        var msg = '[HOME] ZWave command failed, ZWave not ready.';
        log.warn(msg);
        result.zwave = msg;
      }
    }
    if (command.nest) {
      log.todo('[HOME] execute Nest Command is NYI.');
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
      if (nestIsReady) {
        var enabled = true;
        if ((modifier === 'OFF') || (command.dropcam.all === false)) {
          enabled = false;
        }
        try {
          if (enabled) {
            nest.enableCamera();
          } else {
            nest.disableCamera();
          }
          result.dropcam = enabled;
        } catch (ex) {
          log.exception('[HOME] Nest Cam change failed', ex);
          result.dropcam = ex;
        }
      } else {
        msg = '[HOME] Nest Cam change failed, Nest cam not ready.';
        log.warn(msg);
        result.dropcam = msg;
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
    log.todo('[HOME] setTemperature not yet implemented.');
    return {result: 'NYI'};
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

  function initPresence() {
    presence = new Presence();
    presence.on('error', function(err) {
      log.debug('[HOME] Presence error, whoops!');
    });
    presence.on('change', function(person, present, who) {
      person.date = Date.now();
      fbPush('logs/presence', person);
      fbSet('state/presence', who);
      var cmd = 'PRESENCE_SOME';
      if (present === 0) {
        cmd = 'PRESENCE_NONE';
      }
      _self.executeCommand(cmd, null, 'PRESENCE');
    });
    var fbPresPath = 'config/HomeOnNode/presence/people';
    fb.child(fbPresPath).on('child_added', function(snapshot) {
      presence.addPerson(snapshot.val());
    });
    fb.child(fbPresPath).on('child_removed', function(snapshot) {
      var uuid = snapshot.val().uuid;
      presence.removePersonByKey(uuid);
    });
    fb.child(fbPresPath).on('child_changed', function(snapshot) {
      presence.updatePerson(snapshot.val());
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

  function initZWave() {
    log.todo('[HOME] execute ZWave Command is NYI.');
  }

  function init() {
    log.init('[HOME] Initializing home.');
    _self.state.systemState = 'STARTING';
    var now = Date.now();
    var now_ = moment(now).format('YYYY-MM-DDTHH:mm:ss.SSS');
    _self.state = {
      doNotDisturb: {enabled: false},
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
    fb.child('config/HomeOnNode').on('value', function(snapshot) {
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
    initOutsideTemp();
    initNotifications();
    if (config.features.zwave === true) {
      initZWave();
    }
    if (config.features.nest === true) {
      initNest();
    }
    if (config.features.hue === true) {
      initHue();
    }
    if (config.features.harmony === true) {
      initHarmony();
    }
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
