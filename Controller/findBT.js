var noble = require('noble');


noble.on('stateChange', function(state) {
  if (state === 'poweredOn') {
    noble.startScanning([], true);
  } else {
    noble.stopScanning();
  }
});

console.log("UUID                              Name                RSSI TXPr");
console.log("--------------------------------- ------------------- ---- ----");
noble.on('discover', function(peripheral) {
  var pad = "                                             ";
  var uuid = (pad + peripheral.uuid).slice(-32);
  var localName = peripheral.advertisement.localName;
  if (localName === undefined) { localName = ""; }
  localName = (pad + localName).slice(-20);
  var rssi = (pad + peripheral.rssi).slice(-4);
  var txPower = peripheral.advertisement.txPowerLevel;
  if (txPower === undefined) { txPower = "0000"; }
  txPower = (pad + txPower).slice(-4);
  console.log(uuid, localName, rssi, txPower);
});
