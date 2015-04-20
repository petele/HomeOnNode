#!/bin/sh

echo Exporting pin 23 and pulling up
gpio-admin export 23 pullup

echo Starting app...
OUTPUT=$(node app.js 2>&1 >/dev/tty)
echo "${OUTPUT}"
echo "${OUTPUT}" > last_failure.txt
