'use strict';

var EventEmitter = require('events').EventEmitter;
var util = require('util');
var exec = require('child_process').exec;
var log = require('./SystemLog');
var Keys = require('./Keys');
var fs = require('fs');
var moment = require('moment');

var InsideTemperature = require('./InsideTemperature');
var Firebase = require('firebase');
var AirConditioner = require('./AirConditioner');
var Harmony = require('./Harmony');
var Hue = require('./Hue');
var Door = require('./Door');
var GoogleVoice = require('./GoogleVoice');
var Dropcam = require('./Dropcam');
var Presence = require('./Presence');

function Home(config, fb) {
  this.state = {};
  this.state.time = {};
  this.harmonyConfig = {};
  var ready = false;
  var _self = this;

  var armingTimer, awayTimer;
  var hue, harmony, dropcam, presence, airConditioners, insideTemp, doors, chromecast, gv;

  this.setLights = function(lights, state, source) {
    var response = {
      'date': Date.now(),
      'lights': lights,
      'state': state,
      'source': source
    };
    var logMsg = 'Set Lights: [' + lights.toString() + '] ' + JSON.stringify(state);
    if (source) {
      logMsg += ' from: ' + source;
    }
    log.log(logMsg);
    response.response = hue.setLights(lights, state);
    return response;
  };

  this.set = function(command, modifier, source) {
    var response = {
      'date': Date.now(),
      'command': command,
      'modifier': modifier,
      'source': source
    };
    var logMsg = 'Command Received: ' + command + ' ' + '[' + modifier + ']';
    if (source) {
      logMsg += ' from: ' + source;
    }
    log.log(logMsg);
    var cmd = config.commands[command];
    if (cmd) {
      if (cmd.system_state) {
        response.state = setState(cmd.system_state);
      }
      if (cmd.hue) {
        response.hue = [];
        for (var i = 0; i < cmd.hue.length; i++) {
          var hueCmd;
          if ((modifier === 'UP') || (modifier === 'DOWN')) {
            hueCmd = modifier;
          } else {
            hueCmd = modifier || cmd.hue[i].command;
            hueCmd = config.light_recipes[hueCmd];
          }
          if (hueCmd !== undefined) {
            try  {
              response.hue.push(hue.setLights(cmd.hue[i].lights, hueCmd));
            } catch (ex) {
              response.hue.push(ex);
              log.exception('[HOME] Could not set Hue. ', ex);
            }
          } else {
            var msg = 'Invalid modifier (' + modifier + ') for Hue.';
            response.hue.push(msg);
            log.error('[HOME] ' + msg);
          }
        }
      }
      if (cmd.ac) {
        response.ac = [];
        var acKeys = Object.keys(cmd.ac);
        for (var i = 0; i < acKeys.length; i++) {
          var acID = acKeys[i];
          var curTemp = _self.state.ac[acID];
          try {
            curTemp = parseInt(curTemp, 10);
          } catch (ex) {
            log.exception('[HOME] Current AirConditioner[' + acID + '] Temp not an integer. ' + curTemp, ex);
            curTemp = config.airconditioners.default_temperature;
          }
          var newTemp;

          if (modifier === undefined) {
            newTemp = cmd.ac[acID];
          } else if (modifier === 'Off') {
            newTemp = 0;
          } else if (modifier === 'DOWN') {
            newTemp = curTemp - 1;
          } else if (modifier === 'UP') {
            newTemp = curTemp + 1;
          }

          if (newTemp !== undefined) {
            response.ac.push(_self.setTemperature(acID, newTemp));
          } else {
            var errorMessage = '[HOME] Invalid modifier (' + String(modifier);
            errorMessage += ') setting air conditioner [' + acID + ']';
            log.error(errorMessage);
          }
        }
      }
      if (cmd.harmony) {
        try {
          var activityID = _self.harmonyConfig.activitiesByName[cmd.harmony];
          response.harmony = harmony.setActivity(activityID);
          if (activityID === -1) {
            chromecast.stopApp();
          } else if (cmd.billboard === true) {
            chromecast.startApp();
          }
        } catch (ex) {
          log.exception('[HOME] Could not set Harmony activity. ', ex);
          response.harmony = ex;
        }
      }
      if (cmd.dropcam) {
        try {
          if (dropcam) {
            if ((modifier === 'Off') || (cmd.dropcam === false)) {
              dropcam.enableCamera(false);
            } else {
              dropcam.enableCamera(true);
            }
          }
        } catch (ex) {
          log.exception('[HOME] Could not enable/disable the Dropcam.', ex);
        }
      }
      if (cmd.sound) {
        playSound(cmd.sound);
      }
    }
    log.debug(response);
    return response;
  };

  this.setTemperature = function(id, temperature) {
    var response = {
      'id': id,
      'requestedTemp': temperature
    };
    log.log('Set AC [' + id + '] to ' + temperature.toString() + 'F');

    if (temperature === 'AUTO') {
      if ((_self.state.temperature.inside >= config.airconditioners.auto.inside) ||
          (_self.state.temperature.outside >= config.airconditioners.auto.outside)) {
        temperature = config.airconditioners.default_temperature;
      } else {
        response.result = 'Inside/Outside temp did not meet threshold.';
        return;
      }
    }

    try {
      temperature = parseInt(temperature, 10);
    } catch (ex) {
      log.exception('[HOME] New AirConditioner temp not an integer: ' + temperature, ex);
      response.warning('Temperature was not an int, used default temp instead.');
      temperature = config.airconditioners.default_temperature;
    }
    response.temperature = temperature;

    try {
      if ((temperature === 0)|| ((temperature >= 60) && (temperature <= 75))) {
        airConditioners[id].setTemperature(temperature, function() {
        });
        _self.state.ac[id] = temperature;
        fbSet('state/ac/' + id, temperature);
      } else {
        var msg = '[HOME] Invalid temperature (' + temperature;
        msg += ') send to air conditioner [' + id + ']';
        log.debug(msg);
        response.error = 'Temperature out of range.';
      }
    } catch (ex) {
      log.exception('[HOME] Error setting AirConditioner temperature: ' + temperature, ex);
      response.error = ex;
    }

    return response;
  };

  this.doorChange = function(doorName, doorState, source) {
    var response = {
      'label': doorName,
      'state': doorState,
      'date': Date.now(),
      'source': source,
      'homeState': _self.state.system_state
    };
    if ((_self.state.system_state === 'AWAY') && (doorState === 'OPEN')) {
      _self.set('HOME');
      response.homeState = '*HOME*';
    }
    _self.state.doors[doorName] = doorState;
    fbSet('state/doors/' + doorName, doorState);
    fbPush('logs/door', response);
    log.log('[DOOR] ' + doorName + ' ' + doorState);
    
    return response;
  };

  this.shutdown = function() {
    fbPush('logs/app', {'date': Date.now(), 'module': 'HOME', 'state': 'SHUTDOWN'});
    clearInterval(awayTimer);
    if (armingTimer) {
      clearTimeout(armingTimer);
    }
    harmony.close();
  };

  function fbPush(path, value) {
    var fbObj = fb;
    if (path) {
      fbObj = fb.child(path);
    }
    try {
      fb.child('state/time').update({'last_updated': moment().format('YYYY-MM-DDTHH:mm:ss.sss')});
      fbObj.push(value);
      _self.state.time.last_updated = Date.now();
    } catch (ex) {
      log.exception('[HOME] Unable to PUSH data to firebase.', ex);
      log.log(' - FBPath: ' + path);
      log.log(' - Value: ' + JSON.stringify(value));
    }
  }

  function fbSet(path, value) {
    var fbObj = fb;
    if (path) {
      fbObj = fb.child(path);
    }
    try {
      fb.child('state/time').update({'last_updated': moment().format('YYYY-MM-DDTHH:mm:ss.sss')});
      fbObj.set(value);
      _self.state.time.last_updated = Date.now();
    } catch (ex) {
      log.exception('[HOME] Unable to SET data to firebase.', ex);
      log.log(' - FBPath: ' + path);
      log.log(' - Value: ' + JSON.stringify(value));
    }
  }

  function setState(state) {
    log.log('Set State: ' + state);
    if (state === 'ARMED') {
      if (armingTimer) {
        clearTimeout(armingTimer);
      }
      armingTimer = setTimeout(function() {
        armingTimer = null;
        setState('AWAY');
        _self.set('LIGHTSOFF');
      }, config.arming_delay);
    } else if (state === 'HOME') {
      // Check if we have any new GoogleVoice Messages
      try {
        if (_self.state.gvoice.all > 0) {
          _self.set('GV_NEW');
        }
      } catch (ex) {
        _self.set('ERROR');
        var msg = '[HOME] Error checking GVoice messages on HOME state change.';
        log.exception(msg, ex);
      }
    }
    _self.state.system_state = state;
    fbSet('state/system_state', state);
    fbPush('logs/system_state', {'date': Date.now(), 'state': state});
    return state;
  }

  function playSound(file) {
    setTimeout(function() {
      var cmd = 'mplayer -ao alsa -really-quiet -noconsolecontrols ';
      cmd += file;
      exec(cmd, function(error, stdout, stderr) {
        if (error !== null) {
          log.error('[HOME] PlaySound Error: ' + error.toString());
        }
      });
      log.debug('PlaySound: ' + file);
    }, 1);
  }

  function initInsideTemp() {
    insideTemp = new InsideTemperature(config.temperature.inside.interval);
    if (_self.state.temperature === undefined) {
      _self.state.temperature = {};
    }
    insideTemp.on('error', function(error) {
      _self.state.temperature.inside = -1;
      fbSet('state/temperature/inside', error);
      log.error('[HOME] Error reading inside temperature: ' + error);
      _self.set('ERROR');
    });
    insideTemp.on('change', function(data) {
      var val = parseFloat(data.f).toFixed(2);
      _self.state.temperature.inside = val;
      fbSet('state/temperature/inside', val);
      fbPush('logs/temperature/inside', {'temperature': val, 'time': Date.now()});
      log.debug('[HOME] Inside temperature is ' + val + 'F');
    });
  }

  function initOutsideTemp() {
    if (_self.state.temperature === undefined) {
      _self.state.temperature = {};
    }
    if (_self.state.time === undefined) {
      _self.state.time = {};
    }
    var url = 'https://publicdata-weather.firebaseio.com/';
    url += config.temperature.outside.city;
    var weatherRef = new Firebase(url);
    weatherRef.child('currently/temperature').on('value', function(snapshot) {
      _self.state.temperature.outside = snapshot.val();
      fbSet('state/temperature/outside', snapshot.val());
      log.debug('[HOME] Outside temperature is ' + snapshot.val() + 'F');
    });
    weatherRef.child('daily/data/0').on('value', function(snapshot) {
      _self.state.time.sunrise = snapshot.val()['sunriseTime'] * 1000;
      _self.state.time.sunset = snapshot.val()['sunsetTime'] * 1000;
      fbSet('state/time/sunrise', _self.state.time.sunrise);
      fbSet('state/time/sunset', _self.state.time.sunset);
    });
  }

  function initAC() {
    airConditioners = {};
    _self.state.ac = {};
    var ip = config.airconditioners.itach_ip;
    config.airconditioners.ac.forEach(function(elem) {
      var id = elem.id;
      var irPort = elem.irPort;
      var cmds = config.airconditioners.commands[elem.protocol];
      airConditioners[id] = new AirConditioner(id, ip, irPort, cmds);
      _self.state.ac[id] = 0;
      fbSet('state/ac/' + id, 0);
    });
  }

  function initDropcam() {
    var dcConfig = Keys.keys.dropcam;
    _self.state.dropcam = {
      'streaming': false
    };
    dropcam = new Dropcam(dcConfig.user, dcConfig.password, dcConfig.uuid);
    dropcam.on('error', function(err) {
      log.error('[HOME] Dropcam Error: ' + JSON.stringify(err));
      _self.set('ERROR');
    });
    dropcam.on('ready', function() {
      log.log('[HOME] Dropcam Ready');
    });
    dropcam.on('change', function(state) {
      _self.state.dropcam = state;
      fbSet('state/dropcam', state);
    });
  }

  function initPresence() {
    presence = new Presence(config.presence.max_away);
    presence.on('error', function(err) {
      log.error('[HOME] Presence Error: ' + JSON.stringify(err));
      _self.set('ERROR');
    });
    presence.on('change', function(data) {
      fbPush('logs/presence', data.person);
      //log.log('[HOME] data.present: ' + data.present);
      //log.log('[HOME] config.presence.disable_cam: ' + config.presence.disable_cam);
      //log.log('[HOME] _self.state.dropcam: ')
      if ((data.present >= 1) && (config.presence.disable_cam === true) &&
          (_self.state.dropcam.streaming === true)) {
            dropcam.enableCamera(false);
            log.log('[HOME] DropCam disabled by Presence detection.');
      }
    });
    fb.child('config/presence/people').on('value', function(snapshot) {
      presence.addPeople(snapshot.val());
    });
  }

  function initHarmony() {
    _self.state.harmony = {};
    harmony = new Harmony(config.harmony.ip, Keys.keys.harmony);
    harmony.on('activity', function(activity) {
      var activityName = '';
      try {
        activityName = activity;
        if (_self.harmonyConfig.activitiesByID) {
          activityName = _self.harmonyConfig.activitiesByID[activity];
        }
        log.log('[HOME] Harmony activity changed: ' + activityName);
      } catch (ex) {
        log.exception('[HOME] Error determining Harmony activity.', ex);
        activityName = 'ERROR';
      }
      _self.state.harmony.activity_id = activity;
      fbSet('state/harmony/activity_id', activity);
      _self.state.harmony.activity_name = activityName;
      fbSet('state/harmony/activity_name', activityName);
    });
    harmony.on('config', function(cfg) {
      var activities = cfg.activity;
      cfg.activitiesByID = {};
      cfg.activitiesByName = {};
      for (var i = 0; i < activities.length; i++) {
        var activity = activities[i];
        cfg.activitiesByID[activity.id] = activity.label;
        cfg.activitiesByName[activity.label] = activity.id;
      }
      cfg.activitiesByID['-100'] = 'UNKNOWN';
      cfg.activitiesByName['UNKNOWN'] = '-100';
      _self.harmonyConfig = cfg;
      fbSet('harmony_config', cfg);
    });
    harmony.on('error', function(err) {
      log.error('[HOME] Harmony Error: ' + JSON.stringify(err));
      _self.set('ERROR');
    });
    harmony.on('ready', function() {
      harmony.getConfig();
      harmony.getActivity();
    });
  }

  function initHue() {
    hue = new Hue(config.hue.interval, Keys.keys.hue, config.hue.ip);
    hue.on('change', function(data) {
      _self.state.hue = data;
      fbSet('state/hue', data);
    });
    hue.on('update', function(data) {
      //_self.state.hue = data;
      //fbSet('state/hue', data);
    });
    hue.on('error', function (err) {
      var error = {'error': true, 'result': err};
      _self.state.hue = error;
      fbSet('state/hue', error);
      log.error('[HOME] Error reading Hue state: ' + JSON.stringify(err));
      _self.set('ERROR');
    });
  }

  function initDoor() {
    doors = {};
    _self.state.doors = {};
    config.doors.forEach(function(elem) {
      var door = new Door(elem.label, elem.pin);
      door.on('no-gpio', function(e) {
        _self.state.doors[elem.label] = 'NO_GPIO';
        fbSet('state/doors/' + elem.label, 'NO_GPIO');
        log.error('[HOME] No GPIO for door ' + elem.label + ' ' + e.toString());
      });
      door.on('change', function(data) {
        if (_self.state.system_state === 'AWAY') {
          _self.set('HOME');
        }
        _self.state.doors[elem.label] = data;
        fbSet('state/doors/' + elem.label, data);
        fbPush('logs/door', {'date': Date.now(), 'label': elem.label, 'state': data});
        log.log('[DOOR] ' + elem.label + ' ' + data);
      });
      doors[elem.label] = door;
    });
  }

  function initSMS() {
    fb.child("state/sms").on("value", function(snapshot) {
      if (snapshot.val() === true) {
        if (_self.state.system_state === 'HOME') {
          _self.set('NEW_SMS');
        }
        log.log('[NEW_SMS]');
        snapshot.ref().set(false);
      }
    });
  }

  function initGoogleVoice() {
    gv = new GoogleVoice(config.gvoice.interval);
    gv.on('zero', function(count) {
      if (_self.state.system_state === 'HOME') {
        _self.set('GV_ZERO');
      }
      _self.state.gvoice = count;
      fbSet('state/gvoice', count);
      log.log('[GOOGLEVOICE] Zero');
    });
    gv.on('new', function(count) {
      if (_self.state.system_state === 'HOME') {
        _self.set('GV_NEW');
      }
      _self.state.gvoice = count;
      fbSet('state/gvoice', count);
      log.log('[GOOGLEVOICE] New');
    });
    gv.on('change', function(count) {
      _self.state.gvoice = count;
      fbSet('state/gvoice', count);
      log.log('[GOOGLEVOICE] Change');
    });
    gv.on('error', function(e) {
      if (_self.state.system_state === 'HOME') {
        _self.set('ERROR');
      }
      log.error('[GOOGLEVOICE] Error: ' + JSON.stringify(e));
    });
  }

  function loadConfig() {
    log.log('[HOME] Reading config from Firebase.');
    fb.child('config').on('value', function(snapshot) {
      config = snapshot.val();
      log.log('[HOME] Config file updated.');
      if (ready === false) {
        init();
      }
      fs.writeFile('config.json', JSON.stringify(config, null, 2));
    });
  }

  function init() {
    ready = true;
    var timeStarted = Date.now();
    _self.state.time.started = timeStarted;
    _self.state.time.last_updated = timeStarted;
    fb.child('state/time').update({'started': timeStarted});
    log.log('[HOME] Initalizing components.');
    setState('AWAY');
    initAC();
    initDropcam();
    initSMS();
    //initGoogleVoice();
    initInsideTemp();
    initOutsideTemp();
    initDoor();
    initHarmony();
    initHue();
    initPresence();
    _self.emit('ready');
    fbPush('logs/app', {'date': Date.now(), 'module': 'HOME', 'state': 'READY'});
    _self.state.version = log.version;
    fbSet('state/version', log.version);
    playSound(config.ready_sound);
  }

  loadConfig();
  fbPush('logs/app', {'date': Date.now(), 'module': 'HOME', 'state': 'STARTING'});
}


util.inherits(Home, EventEmitter);

module.exports = Home;
