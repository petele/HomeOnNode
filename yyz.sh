#!/bin/bash

echo "Starting Toronto..."
echo ""

export NODE_NO_WARNINGS=1

cd ~/HomeOnNode/app

echo "Configuring Node..."
. ~/.nvm/nvm.sh
nvm use
echo ""

cd ~/HomeOnNode/

if [ ! -f ./flic.pid ]; then
  echo "Starting Flic..."
  forever start yyz-flic.json --minUptime 1000 --spinSleepTime 1000
else
  echo "Flic already running..."
fi

if [ ! -f ./gpio.pid ]; then
  echo "Starting GPIO..."
  forever start yyz-gpio.json  --minUptime 1000 --spinSleepTime 1000
else
  echo "GPIO already running..."
fi
