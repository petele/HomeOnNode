#!/bin/sh

cd app

echo ""
node getConfig.js FlicController
echo ""
node appFlic.js

node appOnError.js >> ./logs/system.log
node appSendNotification.js >> ./logs/system.log
