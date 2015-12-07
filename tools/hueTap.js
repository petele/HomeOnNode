'use strict';

var Keys = require('../app/Keys').keys;
var wr = require('../app/webRequest');
var log = require('../app/SystemLog');
log.setLogfile(null);
log.setDebug(false);

function handleResponse(result) {
  console.log(result);
}

var tapName = 'Scene';
var tapId = 10;
var action1 = [
  {
    address: '/groups/1/action',
    body: {on: true, bri: 25, ct: 320},
    method: 'PUT'
  },
  {
    address: '/groups/2/action',
    body: {on: true, bri: 25, ct: 320},
    method: 'PUT'
  }
];
var action2 = [
  {
    address: '/lights/19/state',
    body: {on: true, bri: 100, xy: [0.2591, 0.0916]},
    method: 'PUT'
  }
];
var action3 = [
  {
    address: '/lights/19/state',
    body: {on: false},
    method: 'PUT'
  }
];
var action4 = [
  {
    address: '/lights/19/state',
    body: {on: true, bri: 100, xy: [0.674, 0.322]},
    method: 'PUT'
  }
];

var button1 = {
  name: tapName + ' - 1',
  conditions: [
    {
      address: '/sensors/' + tapId + '/state/buttonevent',
      operator: 'eq',
      value: '34'
    }, {
      address: '/sensors/' + tapId + '/state/lastupdated',
      operator: 'dx'
    }
  ],
  actions: action1
};
var button2 = {
  name: tapName + ' - 2',
  conditions: [
    {
      address: '/sensors/' + tapId + '/state/buttonevent',
      operator: 'eq',
      value: '16'
    }, {
      address: '/sensors/' + tapId + '/state/lastupdated',
      operator: 'dx'
    }
  ],
  actions: action2
};
var button3 = {
  name: tapName + ' - 3',
  conditions: [
    {
      address: '/sensors/' + tapId + '/state/buttonevent',
      operator: 'eq',
      value: '17'
    }, {
      address: '/sensors/' + tapId + '/state/lastupdated',
      operator: 'dx'
    }
  ],
  actions: action3
};
var button4 = {
  name: tapName + ' - 4',
  conditions: [
    {
      address: '/sensors/' + tapId + '/state/buttonevent',
      operator: 'eq',
      value: '18'
    }, {
      address: '/sensors/' + tapId + '/state/lastupdated',
      operator: 'dx'
    }
  ],
  actions: action4
};

var hubIP = '10.0.0.210';
var basePath = '/api/' + Keys.hueBridge.key + '/rules';
var uri = {
  host: hubIP,
  path: basePath,
  method: 'POST'
};

setTimeout(function() {
  wr.request(uri, JSON.stringify(button1), handleResponse);
}, 1);
setTimeout(function() {
  wr.request(uri, JSON.stringify(button2), handleResponse);
}, 150);
setTimeout(function() {
  wr.request(uri, JSON.stringify(button3), handleResponse);
}, 300);
setTimeout(function() {
  wr.request(uri, JSON.stringify(button4), handleResponse);
}, 450);
