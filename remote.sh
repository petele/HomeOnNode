#!/bin/sh

cd app

if [ "$1" != "" ]; then
  node getConfig.js $1
  echo ""
  node appRemote.js $1
else
  echo "No app id provided, cannot start!"
fi

node appOnError.js
node sendGCMMessage.js
