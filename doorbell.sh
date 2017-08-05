#!/bin/sh

cd app

echo ""
node getConfig.js Doorbell
echo ""
node appDoorbell.js

node appOnError.js >> ./logs/system.log
node appSendNotification.js >> ./logs/system.log
