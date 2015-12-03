'use strict';

var HueApi = require('../app/node_modules/node-hue-api/index').HueApi;
var Keys = require('../app/Keys').keys;

function handleResponse(err, result) {
  if (err) {
    console.error(err);
  } else {
    console.log(result);
  }
}

var hubIP = '10.0.0.210';
var hue = new HueApi(hubIP, Keys.hueBridge.key);


//hue.createGroup('Sleep', [1,2,3,4,5, 6,7,8,9,10, 11,12,13,14,18,19], handleResponse);
//hue.createGroup('Front Hall', [1,2,3], handleResponse);
//hue.createGroup('Front Hall', [1,2,3], handleResponse);
hue.groups(handleResponse);
