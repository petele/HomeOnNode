#!/bin/bash

cd app

echo ""
node getConfig.js HomeOnNode
echo ""
node appController.js

node appOnError.js
node appSendNotification.js
