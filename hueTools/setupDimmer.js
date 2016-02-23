'use strict';

var Keys = require('../app/Keys').keys;
var Hue = require('../app/Hue');

var hubIP = '10.0.0.210';
var hue = new Hue(Keys.hueBridge.key, hubIP);

var dimmerName = 'Bedroom';
var dimmerId = 6;
var lights = [
  '/groups/6/action',
  '/groups/8/action'
];

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

// var dimmerName = 'Front Hall';
// var dimmerId = 12;
// var lights = [
//   '/groups/1/action'
// ];

// var dimmerName = 'Living Room - Rear';
// var dimmerId = 13;
// var lights = [
//   '/groups/3/action',
//   '/groups/4/action'
// ];

// var dimmerName = 'Front Door';
// var dimmerId = 14;
// var lights = [
//   '/groups/1/action'
// ];

// var dimmerName = 'Bedside';
// var dimmerId = 15;
// var lights = [
//   '/groups/7/action'
// ];

var buttonOn = {
  name: dimmerName + ' - ON',
  conditions: [
    {
      address: '/sensors/' + dimmerId + '/state/buttonevent',
      operator: 'eq',
      value: '1000'
    }, {
      address: '/sensors/' + dimmerId + '/state/lastupdated',
      operator: 'dx'
    }
  ],
  actions: []
};
var buttonOff = {
  name: dimmerName + ' - OFF',
  conditions: [
    {
      address: '/sensors/' + dimmerId + '/state/buttonevent',
      operator: 'eq',
      value: '4000'
    }, {
      address: '/sensors/' + dimmerId + '/state/lastupdated',
      operator: 'dx'
    }
  ],
  actions: []
};
var buttonUp0 = {
  name: dimmerName + ' - Up0',
  conditions: [
    {
      address: '/sensors/' + dimmerId + '/state/buttonevent',
      operator: 'eq',
      value: '2000'
    }, {
      address:  '/sensors/' + dimmerId + '/state/lastupdated',
      operator: 'dx'
    }
  ],
  actions: []
};
var buttonUp1 = {
  name: dimmerName + ' - Up1',
  conditions: [
    {
      address: '/sensors/' + dimmerId + '/state/buttonevent',
      operator: 'eq',
      value: '2001'
    }, {
      address: '/sensors/' + dimmerId + '/state/lastupdated',
      operator: 'dx'
    }
  ],
  actions: []
};
var buttonUp3 = {
  name: dimmerName + ' - Up3',
  conditions: [
    {
      address: '/sensors/' + dimmerId + '/state/buttonevent',
      operator: 'eq',
      value: '2003'
    }, {
      address: '/sensors/' + dimmerId + '/state/lastupdated',
      operator: 'dx'
    }
  ],
  actions: []
};
var buttonDown0 = {
  name: dimmerName + ' - Down0',
  conditions: [
    {
      address: '/sensors/' + dimmerId + '/state/buttonevent',
      operator: 'eq',
      value: '3000'
    }, {
      address: '/sensors/' + dimmerId + '/state/lastupdated',
      operator: 'dx'
    }
  ],
  actions: []
};
var buttonDown1 = {
  name: dimmerName + ' - Down1',
  conditions: [
    {
      address: '/sensors/' + dimmerId + '/state/buttonevent',
      operator: 'eq',
      value: '3001'
    }, {
      address: '/sensors/' + dimmerId + '/state/lastupdated',
      operator: 'dx'
    }
  ],
  actions: []
};
var buttonDown3 = {
  name: dimmerName + ' - Down3',
  conditions: [
    {
      address: '/sensors/' + dimmerId + '/state/buttonevent',
      operator: 'eq',
      value: '3003'
    }, {
      address: '/sensors/' + dimmerId + '/state/lastupdated',
      operator: 'dx'
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

function sendRequest(index) {
  var button = buttons[index];
  if (button) {
    hue.makeHueRequest('/rules', 'POST', button, false, function(err, result) {
      if (err) {
        console.log('ERROR', index, err);
        return;
      }
      console.log('OK', index, JSON.stringify(result));
      sendRequest(index + 1);
    });
  }
}

var buttons = [buttonOn, buttonUp0, buttonUp1, buttonUp3, buttonDown0,
  buttonDown1, buttonDown3, buttonOff];

sendRequest(0);
