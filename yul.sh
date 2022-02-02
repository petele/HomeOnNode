#!/bin/bash

cd ~/HomeOnNode/app

echo "Configuring Node..."
. ~/.nvm/nvm.sh
nvm use
echo ""
echo ""

forever start --minUptime 1000 --spinSleepTime 1000 ~/watch-pages/forever.json

node appGPIO.js FrontDoor
