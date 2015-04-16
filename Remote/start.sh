#!/bin/sh

echo Starting app...
OUTPUT=$(node app.js 2>&1 >/dev/tty)
echo "${OUTPUT}"
echo "${OUTPUT}" > last_failure.txt
