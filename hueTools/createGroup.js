'use strict';

var Keys = require('../app/Keys').keys;
var Hue = require('../app/Hue');

var hubIP = '10.0.0.210';
var hue = new Hue(Keys.hueBridge.key, hubIP);

function handleResponse(err, result) {
  if (err) {
    console.error('ERROR', err);
  } else {
    console.log('OK', result);
  }
}

hue.createGroup('Front Hall', [1,2,3], handleResponse);
