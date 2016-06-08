'use strict';

var Keys = require('../app/Keys').keys;
var request = require('request');

var body = {
  name: '',
  lights: [],
  recycle: false,
  appdata: {data: 'HomeOnNode', version: 1},
  transitiontime: 250
};

var reqOpt = {
  url: 'http://192.168.1.210/api/' + Keys.hueBridge.key + '/scenes/',
  method: 'POST',
  json: true,
  body: body
};

request(reqOpt, function(error, response, body) {
  if (error) {
    console.log('ERROR', error);
    return;
  }
  if (body && body[0] && body[0].success) {
    console.log('Success', body[0].success.address);
  } else {
    console.log('Odd?', body);
  }
});
