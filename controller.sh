#!/bin/sh

cd app

node getConfig.js HomeOnNode
echo ""
node appController.js
