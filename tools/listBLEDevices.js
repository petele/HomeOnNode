'use strict';

var noble = require('../app/node_modules/noble');
var ansi = require('ansi'), cursor = ansi(process.stdout);

var devices = [];

function lf () { return '\n'; }
var pad = '                                             ';

cursor.write(Array.apply(null, new Array(process.stdout.getWindowSize()[1])).map(lf).join(''))
  .eraseData(2)
  .goto(1, 1);
console.log('UUID                              Name                RSSI TXPr');
console.log('--------------------------------- ------------------- ---- ----');

noble.on('stateChange', function(state) {
  if (state === 'poweredOn') {
    noble.startScanning([], true);
  } else {
    noble.stopScanning();
  }
});

noble.on('discover', function(peripheral) {
  var index = devices.indexOf(peripheral.uuid);
  if (index === -1) {
    devices.push(peripheral.uuid);
    index = devices.length - 1;
  }
  var uuid = (pad + peripheral.uuid).slice(-32);
  var localName = peripheral.advertisement.localName;
  if (localName === undefined) { localName = ''; }
  localName = (pad + localName).slice(-20);
  var rssi = (pad + peripheral.rssi).slice(-4);
  var txPower = peripheral.advertisement.txPowerLevel;
  if (txPower === undefined) { txPower = '0000'; }
  txPower = (pad + txPower).slice(-4);
  cursor.goto(1, index+3);
  console.log(uuid, localName, rssi, txPower);
});

process.on('SIGINT', function() {
  var lines = devices.length;
  cursor.goto(1, lines+4);
  cursor.reset();
  process.exit();
});
