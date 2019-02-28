#!/bin/sh

echo "Resetting any local file changes..."
git reset --hard
echo ""
echo ""

echo "Getting latest version..."
git pull
echo ""
echo ""

echo "Creating lastest version file..."
last_commit=$(git rev-list HEAD --max-count=1 | cut -c1-7)
sed "s/\[HEAD\]/$last_commit/g" ./app/version.js > v.js && mv v.js ./app/version.js
