#!/bin/sh

cd app

echo "Getting config..."
node getConfig.js VPNMonitor

echo "Starting VPN Monitor..."
node appVPN.js

node appOnError.js >> ./logs/system.log
node appSendNotification.js >> ./logs/system.log
