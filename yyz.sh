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
  forever start yyz-flic.json
fi

if [ ! -f ./gpio.pid ]; then
  echo "Starting GPIO..."
  forever start yyz-gpio.json
fi
