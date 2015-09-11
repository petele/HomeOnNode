#!/bin/sh

cd app

echo "Starting remote client..."
node getConfig.js
node appRemote.js
