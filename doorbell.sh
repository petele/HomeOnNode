#!/bin/sh

cd app

echo ""
node getConfig.js Doorbell
echo ""
node appDoorbell.js

node appOnError.js >> ./logs/system.log
node sendGCMMessage.js >> ./logs/system.log
