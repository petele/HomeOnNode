#!/bin/bash

cd app

echo ""
node getConfig.js HomeOnNode
echo ""
node appController.js
echo ""
echo "HomeOnNode exited."

node appOnError.js
node sendGCMMessage.js
