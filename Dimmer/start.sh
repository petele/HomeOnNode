#!/bin/sh

echo Getting latest keyboard commands...
rm ./dimmer.json
cp ../KeypadConfigs/dimmer-bedside.json ./dimmer.json

echo Updating any node modules...
npm install

echo Starting app...
forever start app.js -m 1 -l ./logs/forever.log
