'use strict';

/* node14_ready */

const fetch = require('node-fetch');
const Keys = require('./Keys').keys;

const KEY = Keys.hueKey;
const LIGHT_ID = '27';
const BRIDGE_IP = '192.168.86.206';
const LIGHT_COMMAND = {
  on: true,
  bri: 254,
  alert: 'lselect',
  xy: [0.674, 0.322],
};

/**
 * Sends the command to the light.
 */
async function go() {
  const url = `http://${BRIDGE_IP}/api/${KEY}/lights/${LIGHT_ID}/state`;
  const fetchOpts = {
    method: 'put',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify(LIGHT_COMMAND),
  };
  const r = await fetch(url, fetchOpts);
  console.log(await r.json());
}

go();
