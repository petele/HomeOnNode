#!/bin/bash

cd app

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

