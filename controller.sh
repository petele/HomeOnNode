#!/bin/bash

cd ~/HomeOnNode/app

echo "Getting config..."
node getConfig.js HomeOnNode
echo ""
echo ""

echo "Starting app..."
node appController.js

node appOnError.js >> ./logs/system.log
