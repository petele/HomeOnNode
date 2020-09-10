#!/bin/bash

cd ~/HomeOnNode/app

echo "Configuring Node..."
. ~/.nvm/nvm.sh
nvm use
echo ""
echo ""

echo "Starting VPN Monitor..."
node appVPN.js
