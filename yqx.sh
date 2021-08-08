#!/bin/bash

echo "Starting Gander..."
echo ""

cd ~/HomeOnNode/app

echo "Configuring Node..."
. ~/.nvm/nvm.sh
nvm use
echo ""
echo ""

echo "Starting app..."
node appBedJet.js
node appSendNotification.js
