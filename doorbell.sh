#!/bin/sh

cd app

echo ""
node getConfig.js Doorbell
echo ""
node appDoorbell.js
echo ""
echo "Doorbell exited."

node appOnError.js
node sendGCMMessage.js
