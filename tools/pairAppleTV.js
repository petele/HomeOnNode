'use strict';

const AppleTV = require('node-appletv');
const ReadLine = require('readline');

const readLine = ReadLine.createInterface({
  input: process.stdin,
  output: process.stdout
});

function init() {
  go();
}

async function go() {
  console.log('Searching for AppleTVs...')
  const devices = await AppleTV.scan();

  console.log('Found an AppleTV, opening connection...')
  const device = devices[0];
  await device.openConnection();

  // Start the pairing...
  console.log('Pairing...')
  const callback = await device.pair();
  // the pin is provided onscreen from the Apple TV
  const pin = await getPin();

  // Send the pin back to the TV
  await callback(pin);

  // you're paired!
  const credentials = device.credentials.toString();
  console.log('Credentials:', credentials);

  await device.closeConnection();
  process.exit(0);
}

function getPin() {
  return new Promise((resolve, reject) => {
    readLine.question('Pin: ', (pin) => {
      resolve(pin);
    });
  });
}




init();
