#!/bin/bash

cd ~/HomeOnNode/app

echo "Getting config..."
node getConfig.js Bedside
echo ""
echo ""

echo "Starting app..."
node appRemote.js Bedside
