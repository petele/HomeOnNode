#!/bin/bash

cd ~/HomeOnNode/app

echo "Getting config..."
node getConfig.js FlicController
echo ""
echo ""

echo "Starting app..."
node appFlic.js
