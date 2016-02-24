#!/bin/bash

cd app

echo ""
echo "Starting Forever in the background..."
forever start -l logs/forever.log -o logs/forever-out.log -e logs/forever-err.log appMonitor.js

echo ""
node getConfig.js HomeOnNode
echo ""
node appController.js
echo ""
echo "HomeOnNode exited."

node sendGCMMessage.js

mplayer sounds/bell.mp3 > /dev/null
mplayer sounds/bell.mp3 > /dev/null
mplayer sounds/bell.mp3 > /dev/null

