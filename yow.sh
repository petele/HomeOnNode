#!/bin/bash

echo "Starting Ottawa..."
echo ""

cd ~/HomeOnNode/app

echo "Configuring Node..."
. ~/.nvm/nvm.sh
nvm use
echo ""

echo "Starting app..."
node appController.js
node appOnError.js >> ./logs/system.log
node appSendNotifications.js