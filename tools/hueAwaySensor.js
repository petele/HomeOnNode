'use strict';

var Keys = require('../app/Keys').keys;
var wr = require('../app/webRequest');
var log = require('../app/SystemLog');
log.setLogfile(null);
log.setDebug(false);

var hubIP = '10.0.0.210';
var tapId = 10;

var sensorUri = {
  host: hubIP,
  path: '/api/' + Keys.hueBridge.key + '/sensors',
  method: 'POST'
};
var awaySensor = {
  name: 'awayToggler',
  type: 'CLIPGenericFlag',
  modelid: 'awayToggler',
  manufacturername: 'HomeOnNode',
  swversion: '1.0',
  uniqueid: '0123456A'
};
wr.request(sensorUri, JSON.stringify(awaySensor), sensorCreated);

function sensorCreated(result) {
  var id = null;
  try {
    id = result[0].success.id;
  } catch (ex) {
    console.log('ERROR - Sensor not created: ', result);
    return;
  }
  createRule(id);
}

function createRule(sensorId) {
  var tapUri = {
    host: hubIP,
    path: '/api/' + Keys.hueBridge.key + '/rules',
    method: 'POST'
  };
  var tapRule = {
    name: 'Tap - Home State Flag Toggler',
    status: 'enabled',
    conditions: [
      {
        address: '/sensors/' + tapId + '/state/buttonevent',
        operator: 'eq',
        value: '34'
      },
      {
        address: '/sensors/' + tapId + '/state/lastupdated',
        operator: 'dx'
      }
    ],
    actions: [
      {
        address: '/sensors/' + sensorId + '/state',
        method: 'PUT',
        body: {flag: true}
      }
    ]
  };
  wr.request(tapUri, JSON.stringify(tapRule), function(result) {
    console.log('createRule result:', result);
  });
}
