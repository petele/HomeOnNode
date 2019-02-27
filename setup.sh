#!/bin/sh

echo "Install forever..."
npm install -g forever

echo "NPM Install (app)"
cd app
mkdir logs
npm install
npm install onoff
cd ..

echo "NPM Install (hueTools)"
cd hueTools
npm install
cd ..
