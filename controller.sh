#!/bin/bash

cd app

echo ""
node getConfig.js HomeOnNode
echo ""
nvm use 6
node appController.js

node appOnError.js
node appSendNotification.js
