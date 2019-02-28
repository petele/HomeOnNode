#!/bin/bash

cd ~/HomeOnNode/app

echo "Getting config..."
node getConfig.js VPNMonitor
echo ""
echo ""

echo "Starting VPN Monitor..."
node appVPN.js
