#!/bin/bash

cd ~/HomeOnNode/app

echo "Configuring Node..."
. ~/.nvm/nvm.sh
nvm use
echo ""
echo ""

if [ ! -f ./gpio.pid ]; then
  echo "Starting GPIO..."
  forever start --minUptime 1000 --spinSleepTime 1000 yul-gpio.json
else
  echo "GPIO already running..."
fi
