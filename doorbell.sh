#!/bin/bash

cd ~/HomeOnNode/app

echo "Getting config..."
node getConfig.js DoorBell
echo ""
echo ""

echo "Starting app..."
node appGPIO.js

node appOnError.js >> ./logs/system.log
