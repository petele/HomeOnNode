#!/bin/sh

cd app

echo "Starting controller..."
node getConfig.js
node appController.js
