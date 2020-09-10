#!/bin/bash

cd ~/HomeOnNode/app

echo "Configuring Node..."
. ~/.nvm/nvm.sh
nvm use

echo "Starting app..."
node appController.js

node appOnError.js >> ./logs/system.log
