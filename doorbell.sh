#!/bin/sh

cd app

echo ""
node getConfig.js DoorBell
echo ""
node appGPIO.js

node appOnError.js >> ./logs/system.log
node appSendNotification.js >> ./logs/system.log
