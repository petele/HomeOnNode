'use strict';

const https = require('https');
const Keys = require('../app/Keys').keys;
const readline = require('readline');

// https://console.developers.nest.com/products/CLIENT_ID

function generatePinURL() {
  let url = 'https://home.nest.com/login/oauth2?client_id=';
  url += Keys.nest.clientId;
  url += '&state=' + Math.random();
  console.log(`Open ${url} in your browser...`);
}

function getAccessToken(pin, callback) {
  let path = '/oauth2/access_token?';
  path += 'code=' + pin;
  path += '&client_id=' + Keys.nest.clientId;
  path += '&client_secret=' + Keys.nest.clientSecret;
  path += '&grant_type=authorization_code';
  const options = {
    hostname: 'api.home.nest.com',
    path: path,
    method: 'POST'
  };
  let request = https.request(options, function(resp) {
    let result = '';
    resp.on('data', function(data) {
      result += data;
    });
    resp.on('end', function() {
      console.log(`Nest Access Token: ${result}`);
      if (callback) {
        callback();
      }
    });
  });
  request.end();
  request.on('error', function(err) {
    console.log('[NEST] Error requesting Access Token', err);
  });
}

generatePinURL();
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});
rl.question('Pin: ', function(pin) {
  getAccessToken(pin, function(r) {
    process.exit(0);
  });
});

