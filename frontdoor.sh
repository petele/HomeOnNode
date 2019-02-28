#!/bin/bash

cd ~/HomeOnNode/app

echo "Getting config..."
node getConfig.js FrontDoor
echo ""
echo ""

echo "Starting app..."
node appGPIO.js
