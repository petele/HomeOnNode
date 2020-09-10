#!/bin/bash

cd ~/HomeOnNode/app

echo "Configuring Node..."
. ~/.nvm/nvm.sh
nvm use
echo ""
echo ""

echo "Starting app..."
node appGPIO.js

node appOnError.js >> ./logs/system.log
