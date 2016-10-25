#!/usr/bin/env node
'use strict';

var fs = require('fs');
var Keys = require('../app/Keys').keys;
var request = require('request');
var commander = require('commander');
var log = require('npmlog');

var requestTimeout = 30000;
var hueIP = '192.168.1.206';

var tempNow = Date.now();

console.log('HomeOnNode Hue Dimmer Helper');

commander
  .version('0.1.0')
  .option('-v, --verbose', 'Verbose output')
  .option('-t, --trial', 'Trial only, don\'t make requests.');

commander
  .command('delete <filename>')
  .description('Deletes all of the settings for dimmer definition file <filename>')
  .action(function(filename) {
    setLogLevel(commander.verbose);
    log.info('', 'Deleting dimmer settings from %s', filename);
    readFile(filename)
    .then(deleteRecycleSensor)
    .then(deleteRecycleSchedule)
    .then(deleteRules)
    .then(function(dimmerSettings) {
      return saveFile(filename, dimmerSettings);
    })
    .then(function(dimmerSettings) {
      console.log('Done', dimmerSettings);
    })
    .catch(function(err) {
      console.log('Err', err);
    });

  });

commander
  .command('add <filename>')
  .description('Adds settings for dimmer definition file <filename>')
  .action(function(filename) {
    setLogLevel(commander.verbose);
    log.info('', 'Add dimmer settings from %s', filename);
    readFile(filename)
    .then(addRecycleSensor)
    .then(addRecycleSchedule)
    .then(addRules)
    .then(function(dimmerSettings) {
      dimmerSettings.created = true;
      dimmerSettings.createdOn = Date.now();
      return saveFile(filename, dimmerSettings);
    })
    .then(function(dimmerSettings) {
      console.log('Done', dimmerSettings);
    })
    .catch(function(err) {
      console.log('err', err);
    });
  });

commander.parse(process.argv);
if (commander.args.length === 0) {
  commander.help();
}

function setLogLevel(verbose) {
  if (verbose === true) {
    log.level = 'verbose';
  }
}

function addRecycleSensor(dimmerSettings) {
  var sensor = {
    name: dimmerSettings.name + ' - SceneCycle',
    modelid: 'PHWA01',
    swversion: '1.0',
    type: 'CLIPGenericStatus',
    uniqueid: 'HoN-' + Date.now(),
    manufacturername: Keys.hueBridge.key,
    state: {status: 0},
    config: {on: true, reachable: true},
    recycle: true
  };
  var promise = new Promise(function(resolve, reject) {
    makeRequest('POST', 'sensors', sensor).then(function(response) {
      if (response && response[0] && response[0].success) {
        dimmerSettings.recycleSensorID = response[0].success.id;
        log.info('addRecycleSensor', dimmerSettings.recycleSensorID);
        resolve(dimmerSettings);
      } else {
        log.error('addRecycleSensor',response);
        reject(response);
      }
    });
  });
  return promise;
}

function deleteRecycleSensor(dimmerSettings) {
  var promise = new Promise(function(resolve, reject) {
    if (!dimmerSettings.recycleSensorID) {
      resolve(dimmerSettings);
      return;
    }
    var path =  'sensors/' + dimmerSettings.recycleSensorID;
    makeRequest('DELETE', path).then(function(response) {
      if (response && response[0] && response[0].success) {
        delete dimmerSettings.recycleSensorID;
        resolve(dimmerSettings);
      } else {
        reject(response);
      }
    });
  });
  return promise;
}

function addRecycleSchedule(dimmerSettings) {
  var address = '/api/' + Keys.hueBridge.key + '/sensors/';
  address += dimmerSettings.recycleSensorID + '/state';
  var schedule = {
    name: dimmerSettings.name + ' - Reset',
    description: 'Resets dimmer switch scene cycler',
    command: {
      address: address,
      body: {status: 0},
      method: 'PUT'
    },
    localtime: 'PT00:00:10',
    status: 'disabled',
    autodelete: false,
    recycle: true
  };
  var promise = new Promise(function(resolve, reject) {
    makeRequest('POST', 'schedules', schedule).then(function(response) {
      if (response && response[0] && response[0].success) {
        dimmerSettings.recycleScheduleID = response[0].success.id;
        log.info('addRecycleSchedule', dimmerSettings.recycleScheduleID);
        resolve(dimmerSettings);
      } else {
        log.error('addRecycleSensor', response);
        reject(response);
      }
    });
  });
  return promise;
}

function deleteRecycleSchedule(dimmerSettings) {
  var promise = new Promise(function(resolve, reject) {
    if (!dimmerSettings.recycleScheduleID) {
      resolve(dimmerSettings);
      return;
    }
    var path =  'schedules/' + dimmerSettings.recycleScheduleID;
    makeRequest('DELETE', path).then(function(response) {
      if (response && response[0] && response[0].success) {
        delete dimmerSettings.recycleScheduleID;
        resolve(dimmerSettings);
      } else {
        reject(response);
      }
    });
  });
  return promise;
}

function addRules(dimmerSettings) {
  var rules = generateRules(dimmerSettings);
  var promise = new Promise(function(resolve, reject) {
    if (rules.length === 0) {
      reject(Error('No rules to create :('));
      return;
    }
    dimmerSettings.rules = [];
    rules.reduce(function(sequence, item) {
      return sequence.then(function() {
        return makeRequest('POST', 'rules', item);
      })
      .then(function(response) {
        if (response && response[0] && response[0].success) {
          log.info('addRule', response[0].success.id);
          dimmerSettings.rules.push(response[0].success.id);
        } else {
          log.info('addRule', response);
          reject(Error('Error creating rule'));
        }
      });
    }, Promise.resolve())
    .then(function() {
      resolve(dimmerSettings);
    });
  });
  return promise;
}

function deleteRules(dimmerSettings) {
  var promise = new Promise(function(resolve, reject) {
    if (!dimmerSettings.rules || dimmerSettings.rules.length === 0) {
      resolve(dimmerSettings);
      return;
    }
    dimmerSettings.rules.reduce(function(sequence, item) {
      return sequence.then(function() {
        var path = 'rules/' + item;
        return makeRequest('DELETE', path);
      }).then(function(response) {
        if (response && response[0] && response[0].success) {
          dimmerSettings.rules.push(response[0].success.id);
        } else {
          reject(Error('Error creating rule'));
        }
      });
    }, Promise.resolve())
    .then(function() {
      delete dimmerSettings.rules;
      resolve(dimmerSettings);
    });
  });
  return promise;
}

function generateRules(dimmerSettings) {
  var result = [];
  var dimmerName = dimmerSettings.name;
  var actionPath = '/groups/' + dimmerSettings.groupID + '/action';
  var sensorPath = '/sensors/' + dimmerSettings.sensorID + '/state/';
  var recyclePath = '/sensors/' + dimmerSettings.recycleSensorID + '/state';
  var schedulePath = '/schedules/' + dimmerSettings.recycleScheduleID;

  dimmerSettings.onTap.forEach(function(scene, idx) {
    var rule = {
      actions: [
        {address: actionPath, body: {scene: scene}, method: 'PUT'},
        {address: recyclePath, body: {status: idx + 1}, method: 'PUT'}
      ],
      conditions: [
        {address: sensorPath + 'buttonevent', operator: 'eq', value: '1000'},
        {address: sensorPath + 'lastupdated', operator: 'dx'},
        {address: recyclePath, operator: 'eq', value: idx.toString()}
      ],
      name: dimmerName + ' - On [' + idx + ']'
    };
    result.push(rule);
  });

  var dOff = {
    actions: [
      {address: actionPath, body: {on: false}, method: 'PUT'},
      {address: recyclePath, body: {status: 0}, method: 'PUT'}
    ],
    conditions: [
      {address: sensorPath + 'buttonevent', operator: 'eq', value: '4000'},
      {address: sensorPath + 'lastupdated', operator: 'dx'}
    ],
    name: dimmerName + ' - Off'
  };
  var dUpPress = {
    actions: [{
      address: actionPath,
      body: {bri_inc: 30, transitiontime: 9},
      method: 'PUT'
    }],
    conditions: [
      {address: sensorPath + 'buttonevent', operator: 'eq', value: '2000'},
      {address: sensorPath + 'lastupdated', operator: 'dx'}
    ],
    name: dimmerName + ' - Up Press'
  };
  var dUpLong = {
    actions: [{
      address: actionPath,
      body: {bri_inc: 56, transitiontime: 9},
      method: 'PUT'
    }],
    conditions: [
      {address: sensorPath + 'buttonevent', operator: 'eq', value: '2001'},
      {address: sensorPath + 'lastupdated', operator: 'dx'}
    ],
    name: dimmerName + ' - Up Long'
  };
  var dUpRelease = {
    actions: [{address: actionPath, body: {bri_inc: 0}, method: 'PUT'}],
    conditions: [
      {address: sensorPath + 'buttonevent', operator: 'eq', value: '2003'},
      {address: sensorPath + 'lastupdated', operator: 'dx'}
    ],
    name: dimmerName + ' - Up Release'
  };
  var dDownPress = {
    actions: [{
      address: actionPath,
      body: {bri_inc: -30, transitiontime: 9},
      method: 'PUT'
    }],
    conditions: [
      {address: sensorPath + 'buttonevent', operator: 'eq', value: '3000'},
      {address: sensorPath + 'lastupdated', operator: 'dx'}
    ],
    name: dimmerName + ' - Down Press'
  };
  var dDownLong = {
    actions: [{
      address: actionPath,
      body: {bri_inc: -56, transitiontime: 9},
      method: 'PUT'
    }],
    conditions: [
      {address: sensorPath + 'buttonevent', operator: 'eq', value: '3001'},
      {address: sensorPath + 'lastupdated', operator: 'dx'}
    ],
    name: dimmerName + ' - Downb Long'
  };
  var dDownRelease = {
    actions: [{address: actionPath, body: {bri_inc: 0}, method: 'PUT'}],
    conditions: [
      {address: sensorPath + 'buttonevent', operator: 'eq', value: '3003'},
      {address: sensorPath + 'lastupdated', operator: 'dx'}
    ],
    name: dimmerName + ' - Down Release'
  };
  var dReleaseTimer = {
    actions: [{
      address: schedulePath,
      body: {localtime: 'PT00:00:10', status: 'enabled'},
      method: 'PUT'
    }],
    conditions: [
      {address: sensorPath + 'lastupdated', operator: 'dx'}
    ],
    name: dimmerName + ' - Release Timer'
  };
  result.push(dOff);
  result.push(dUpPress);
  result.push(dUpLong);
  result.push(dUpRelease);
  result.push(dDownPress);
  result.push(dDownLong);
  result.push(dDownRelease);
  result.push(dReleaseTimer);
  return result;
}

function saveFile(filename, dimmerSettings) {
  var promise = new Promise(function(resolve, reject) {
    if (commander.trial === true) {
      resolve(dimmerSettings);
      return;
    }
    log.verbose('readFile', 'Reading %s', filename);
    var data = JSON.stringify(dimmerSettings, null, 2);
    fs.writeFile(filename, data, function(err) {
      if (err) {
        reject(err);
      } else {
        resolve(dimmerSettings);
      }
    });
  });
  return promise;
}

function readFile(filename) {
  var promise = new Promise(function(resolve, reject) {
    log.verbose('readFile', 'Reading %s', filename);
    fs.readFile(filename, 'utf8', function(err, data) {
      if (err) {
        reject(err);
      } else {
        try {
          data = JSON.parse(data);
        } catch (ex) {
          console.log(ex);
          reject(Error('Unable to parse definition file'));
          return;
        }
        if (!data.name) {
          reject(Error('Missing name field'));
          return;
        }
        if (!data.sensorID) {
          reject(Error('Missing sensorID'));
          return;
        }
        resolve(data);
      }
    });
  });
  return promise;
}

function makeRequest(method, path, body) {
  var promise;
  var reqOpt = {
    url: 'http://' + hueIP + '/api/' + Keys.hueBridge.key + '/' + path,
    method: method,
    timeout: requestTimeout,
    json: true
  };
  if (body) {
    reqOpt.body = body;
  }
  var prefix = method + ' ' + path;
  if (commander.trial === true) {
    log.info(prefix, body);
    promise = new Promise(function(resolve, reject) {
      var x = Date.now() - tempNow;
      resolve([{success: {id: x, fake: true}}]);
    });
    return promise;
  }
  log.verbose(prefix, body);
  promise = new Promise(function(resolve, reject) {
    request(reqOpt, function(error, response, body) {
      var respPrefix = 'RESP ' + path;
      var result = body;
      if (error) {
        log.error(respPrefix, error);
        reject([{failed: error}]);
      } else {
        log.info(respPrefix, body);
        resolve(result);
      }
    });
  });
  return promise;
}
