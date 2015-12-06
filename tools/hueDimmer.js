'use strict';

var Keys = require('../app/Keys').keys;
var wr = require('../app/webRequest');
var log = require('../app/SystemLog');
log.setLogfile(null);
log.setDebug(false);

function handleResponse(result) {
  console.log(result);
}

// var dimmerName = 'Bedroom';
// var dimmerId = 6;
// var lights = [
//   '/groups/6/action',
//   '/groups/8/action'
// ];

// var dimmerName = 'Kitchen';
// var dimmerId = 7;
// var lights = [
//   '/groups/2/action',
//   '/lights/17/state'
// ];

// var dimmerName = 'Living Room';
// var dimmerId = 8;
// var lights = [
//   '/groups/3/action',
//   '/groups/4/action'
// ];

// var dimmerName = 'Living Room - Rear';
// var dimmerId = 13;
// var lights = [
//   '/groups/3/action',
//   '/groups/4/action'
// ];

// var dimmerName = 'Front Hall';
// var dimmerId = 12;
// var lights = [
//   '/groups/1/action'
// ];

// var dimmerName = 'Front Door';
// var dimmerId = 14;
// var lights = [
//   '/groups/1/action'
// ];

var buttonOn = {
  name: dimmerName + ' - ON',
  conditions: [
    {
      address: '/sensors/' + dimmerId + '/state/buttonevent',
      operator : 'eq',
      value : '1000'
    }, {
      address : '/sensors/' + dimmerId + '/state/lastupdated',
      operator : 'dx'
    }
  ],
  actions: []
};
var buttonOff = {
  name: dimmerName + ' - OFF',
  conditions: [
    {
      address: '/sensors/' + dimmerId + '/state/buttonevent',
      operator : 'eq',
      value : '4000'
    }, {
      address : '/sensors/' + dimmerId + '/state/lastupdated',
      operator : 'dx'
    }
  ],
  actions: []
};
var buttonUp0 = {
  name: dimmerName + ' - Up0',
  conditions: [
    {
      address: '/sensors/' + dimmerId + '/state/buttonevent',
      operator : 'eq',
      value : '2000'
    }, {
      address : '/sensors/' + dimmerId + '/state/lastupdated',
      operator : 'dx'
    }
  ],
  actions: []
};
var buttonUp1 = {
  name: dimmerName + ' - Up1',
  conditions: [
    {
      address: '/sensors/' + dimmerId + '/state/buttonevent',
      operator : 'eq',
      value : '2001'
    }, {
      address : '/sensors/' + dimmerId + '/state/lastupdated',
      operator : 'dx'
    }
  ],
  actions: []
};
var buttonUp3 = {
  name: dimmerName + ' - Up3',
  conditions: [
    {
      address: '/sensors/' + dimmerId + '/state/buttonevent',
      operator : 'eq',
      value : '2003'
    }, {
      address : '/sensors/' + dimmerId + '/state/lastupdated',
      operator : 'dx'
    }
  ],
  actions: []
};
var buttonDown0 = {
  name: dimmerName + ' - Down0',
  conditions: [
    {
      address: '/sensors/' + dimmerId + '/state/buttonevent',
      operator : 'eq',
      value : '3000'
    }, {
      address : '/sensors/' + dimmerId + '/state/lastupdated',
      operator : 'dx'
    }
  ],
  actions: []
};
var buttonDown1 = {
  name: dimmerName + ' - Down1',
  conditions: [
    {
      address: '/sensors/' + dimmerId + '/state/buttonevent',
      operator : 'eq',
      value : '3001'
    }, {
      address : '/sensors/' + dimmerId + '/state/lastupdated',
      operator : 'dx'
    }
  ],
  actions: []
};
var buttonDown3 = {
  name: dimmerName + ' - Down3',
  conditions: [
    {
      address: '/sensors/' + dimmerId + '/state/buttonevent',
      operator : 'eq',
      value : '3003'
    }, {
      address : '/sensors/' + dimmerId + '/state/lastupdated',
      operator : 'dx'
    }
  ],
  actions: []
};
lights.forEach(function(light) {
  var actionOn = {
    address: light,
    body: {on: true, bri: 254},
    method: 'PUT'
  };
  var actionOff = {
    address: light,
    body: {on: false, transitiontime: 4},
    method: 'PUT'
  };
  var actionUp0 = {
    address: light,
    body: {bri_inc: 30, transitiontime: 9},
    method: 'PUT'
  };
  var actionUp1 = {
    address: light,
    body: {bri_inc: 56, transitiontime: 9},
    method: 'PUT'
  };
  var actionUp3 = {
    address: light,
    body: {bri_inc: 0},
    method: 'PUT'
  };
  var actionDown0 = {
    address: light,
    body: {bri_inc: -30, transitiontime: 9},
    method: 'PUT'
  };
  var actionDown1 = {
    address: light,
    body: {bri_inc: -56, transitiontime: 9},
    method: 'PUT'
  };
  var actionDown3 = {
    address: light,
    body: {bri_inc: 0},
    method: 'PUT'
  };
  buttonOn.actions.push(actionOn);
  buttonOff.actions.push(actionOff);
  buttonUp0.actions.push(actionUp0);
  buttonUp1.actions.push(actionUp1);
  buttonUp3.actions.push(actionUp3);
  buttonDown0.actions.push(actionDown0);
  buttonDown1.actions.push(actionDown1);
  buttonDown3.actions.push(actionDown3);
});

var hubIP = '10.0.0.210';
var basePath = '/api/' + Keys.hueBridge.key + '/rules';
var uri = {
  host: hubIP,
  path: basePath,
  method: 'POST'
};

setTimeout(function() {
  wr.request(uri, JSON.stringify(buttonOn), handleResponse);
}, 1);
setTimeout(function() {
  wr.request(uri, JSON.stringify(buttonUp0), handleResponse);
}, 150);
setTimeout(function() {
  wr.request(uri, JSON.stringify(buttonUp1), handleResponse);
}, 300);
setTimeout(function() {
  wr.request(uri, JSON.stringify(buttonUp3), handleResponse);
}, 450);
setTimeout(function() {
  wr.request(uri, JSON.stringify(buttonDown0), handleResponse);
}, 600);
setTimeout(function() {
  wr.request(uri, JSON.stringify(buttonDown1), handleResponse);
}, 750);
setTimeout(function() {
  wr.request(uri, JSON.stringify(buttonDown3), handleResponse);
}, 900);
setTimeout(function() {
  wr.request(uri, JSON.stringify(buttonOff), handleResponse);
}, 1050);