#!/bin/bash

echo "Starting Vancouver..."
echo ""

cd ~/HomeOnNode/app

echo "Configuring Node..."
. ~/.nvm/nvm.sh
nvm use
echo ""

echo "Starting app..."
node appRemote.js Bedside
