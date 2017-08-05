#!/bin/bash

echo "Starting APP_NAME in 5 seconds"
sleep 5

cd HomeOnNode
./pull.sh

cd app
node appMonitor.js &

cd ..
./controller.sh
