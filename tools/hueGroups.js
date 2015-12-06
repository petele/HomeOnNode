'use strict';

var HueApi = require('../app/node_modules/node-hue-api/index').HueApi;
var Keys = require('../app/Keys').keys;
var wr = require('../app/webRequest');

function handleResponse(err, result) {
  if (err) {
    console.error(err);
  } else {
    console.log(result);
  }
}

var hubIP = '10.0.0.210';
var hue = new HueApi(hubIP, Keys.hueBridge.key);

// hue.createGroup('Front Hall', [1,2,3], handleResponse);
// hue.createGroup('Kitchen - Overhead', [4,5,6,7], handleResponse);
// hue.createGroup('Living Room', [18], handleResponse);
// hue.createGroup('Living Room - Floor', [18], handleResponse);
// hue.createGroup('Living Room - Table', [12], handleResponse)
// hue.createGroup('Bedroom', [8,10,13,19], handleResponse);
// hue.createGroup('Bed Side', [15,16], handleResponse);
// hue.createGroup('Bedroom - Floor', [8,10,13], handleResponse);
