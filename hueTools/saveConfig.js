'use strict';

var Keys = require('../app/Keys').keys;
var request = require('request');
var fs = require('fs');

var filename = 'config.json';

var reqOpt = {
  url: 'http://192.168.1.206/api/' + Keys.hueBridge.key + '',
  method: 'GET',
  json: true
};
request(reqOpt, function(error, response, body) {
  if (error) {
    console.log('ERROR', error);
    return;
  }
  console.log('Completed', body);
  fs.writeFileSync(filename, JSON.stringify(body), 'utf8');
});
