'use strict';

var Keys = require('../app/Keys').keys;
var Hue = require('../app/Hue');

var hubIP = '192.168.1.206';
var hue = new Hue(Keys.hueBridge.key, hubIP);

var dimmerId = 17;
var dimmerName = 'Bedside';
var lights = [
  '/groups/7/action'
];

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
var buttonOnLong = {
  name: dimmerName + ' - ON Long',
  conditions: [
    {
      address: '/sensors/' + dimmerId + '/state/buttonevent',
      operator: 'eq',
      value: '1003'
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
    body: {on: true},
    method: 'PUT'
  };
  var actionOnLong = {
    address: light,
    body: {on: true, ct: 320},
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
  buttonOnLong.actions.push(actionOnLong);
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
  } else {
    process.exit();
  }
}

var buttons = [buttonOn, buttonOnLong, buttonUp0, buttonUp1, buttonUp3, 
  buttonDown0, buttonDown1, buttonDown3, buttonOff];

sendRequest(0);
