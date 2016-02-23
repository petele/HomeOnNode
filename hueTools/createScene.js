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

var lights = [1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21];
var sceneName = 'Watch TV';
hue.createScene(sceneName, lights, handleResponse);
