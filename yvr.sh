#!/bin/bash

echo "Starting Vancouver..."
echo ""

export NODE_NO_WARNINGS=1

cd ~/HomeOnNode/app

echo "Configuring Node..."
. ~/.nvm/nvm.sh
nvm use
echo ""

cd ~/HomeOnNode/

if [ ! -f ./remote.pid ]; then
  echo "Starting Remote..."
  forever start --minUptime 1000 --spinSleepTime 1000 yvr-remote.json
else
  echo "Remote already running..."
fi
