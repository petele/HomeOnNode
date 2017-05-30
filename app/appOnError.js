'use strict';

const Keys = require('./Keys').keys;
const request = require('request');

const KEY = Keys.hueBridge.key;
const LIGHT_ID = '27';
const BRIDGE_IP = '192.168.86.206';

const REQUEST_OPTS = {
  uri: `http://${BRIDGE_IP}/api/${KEY}/lights/${LIGHT_ID}/state`,
  method: 'PUT',
  json: true,
  agent: false,
  body: {
    on: true,
    bri: 254,
    alert: 'lselect',
    xy: [0.674, 0.322],
  },
};

request(REQUEST_OPTS, (error, response, respBody) => {
  if (error) {
    // eslint-disable-next-line no-console
    console.log(error);
    return;
  }
  // eslint-disable-next-line no-console
  console.log(respBody);
  return;
});

