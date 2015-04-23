#!/bin/sh

echo Setting Up Thermometer...
sudo modprobe w1-gpio
sudo modprobe w1-therm

echo Exporting pin 23 and pulling up
gpio-admin export 23 pullup

echo Getting latest keyboard commands...
rm ./Controller/keypad.json
cp ./Configs/primary.json ./Controller/keypad.json

cd Controller

echo Updating any node modules...
npm install

echo Starting app...
OUTPUT=$(node app.js 2>&1 >/dev/tty)
echo "${OUTPUT}"
echo "${OUTPUT}" > last_failure.txt
