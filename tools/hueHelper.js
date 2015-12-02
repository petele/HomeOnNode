'use strict';

var HueApi = require('node-hue-api');
var log = require('./SystemLog');
var Keys = require('../app/Keys').keys;

function handleResponse(err, result) {
  if (err) {
    log.error(err);
  } else {
    log.log(result);
  }
}

var hubIP = '';
var hue = new HueApi(hubIP, Keys.hueBridge.key);

hue.deleteGroup(13, handleResponse);
hue.deleteGroup(12, handleResponse);
hue.deleteGroup(11, handleResponse);
hue.deleteGroup(10, handleResponse);
hue.deleteGroup(9, handleResponse);
hue.deleteGroup(8, handleResponse);
hue.deleteGroup(7, handleResponse);
hue.deleteGroup(6, handleResponse);
hue.deleteGroup(5, handleResponse);
hue.deleteGroup(4, handleResponse);
hue.deleteGroup(3, handleResponse);
hue.deleteGroup(2, handleResponse);
hue.deleteGroup(1, handleResponse);

