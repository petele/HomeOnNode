#!/bin/bash

cd app

echo ""
node getConfig.js HomeOnNode
echo ""
node appController.js

node appOnError.js >> ./logs/system.log
node sendGCMMessage.js >> ./logs/system.log
