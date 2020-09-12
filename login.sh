#!/bin/bash

echo ""
echo ""
echo "Starting APP_NAME in 5 seconds"
echo ""
sleep 5

echo "Updating code..."
cd HomeOnNode
./pull.sh
echo ""
echo ""

echo "Starting monitor..."
forever start monitor.json
echo ""
echo ""

# TODO SETUP HERE
# ./remote.sh Bedside

cd app
node appSendNotification.js >> ./logs/system.log
