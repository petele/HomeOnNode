#!/bin/bash

echo "Starting Ottawa..."
echo ""

cd ~/HomeOnNode/app

echo "Configuring Node..."
. ~/.nvm/nvm.sh
nvm use
echo ""

export GOOGLE_APPLICATION_CREDENTIALS="/home/pi/HomeOnNode/app/KeysPubSub.json"

echo "Starting app..."
node appController.js
node appOnError.js >> ./logs/error.log
node appSendNotification.js