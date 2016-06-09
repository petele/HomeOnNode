'use strict';

var Keys = require('../app/Keys').keys;
var request = require('request');

var body = {
  name: 'Borealis',
  lights: ['1','2','3','4','5','6','7','8','9','10','11','12','13','14','15','16','17','18','19','20','21','22','23'],
  recycle: false,
  appdata: {data: 'HomeOnNode', version: 1}
};

var reqOpt = {
  url: 'http://192.168.1.206/api/' + Keys.hueBridge.key + '/scenes/',
  method: 'POST',
  json: true,
  body: body
};

request(reqOpt, function(error, response, body) {
  if (error) {
    console.log('ERROR', error);
    return;
  }
  console.log('Completed', body);
  // var keys = Object.keys(body);
  // console.log(keys)
  // keys.forEach(function(k) {
  //   console.log(k, body[k].name);
  // });
});
