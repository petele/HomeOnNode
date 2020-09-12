#!/bin/bash

echo "Starting Vancouver..."
echo ""

export NODE_NO_WARNINGS=1

cd ~/HomeOnNode/app

echo "Configuring Node..."
. ~/.nvm/nvm.sh
nvm use
echo ""

echo "Starting app..."
node appRemote.js Bedside
