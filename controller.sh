#!/bin/bash

cd app

echo ""
node getConfig.js HomeOnNode
echo ""
. ~/.nvm/nvm.sh
nvm use 6

npm install cron

node appController.js

node appOnError.js
node appSendNotification.js
