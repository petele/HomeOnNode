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

forever start --minUptime 1000 --spinSleepTime 1000 yyz-flic.json
forever start --minUptime 1000 --spinSleepTime 1000 yyz-gpio.json

# if [ ! -f ./flic.pid ]; then
#   echo "Starting Flic..."
#   forever start --minUptime 1000 --spinSleepTime 1000 yyz-flic.json
# else
#   echo "Flic already running..."
# fi

# echo ""

# if [ ! -f ./gpio.pid ]; then
#   echo "Starting GPIO..."
#   forever start --minUptime 1000 --spinSleepTime 1000 yyz-gpio.json
# else
#   echo "GPIO already running..."
# fi
