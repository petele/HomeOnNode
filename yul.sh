#!/bin/bash

cd ~/HomeOnNode/app

echo "Configuring Node..."
. ~/.nvm/nvm.sh
nvm use
echo ""
echo ""

node appGPIO.js FrontDoor
