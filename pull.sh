#!/bin/sh

echo "Resetting any local file changes..."
git reset --hard

echo "Getting latest version..."
git pull

echo "Creating lastest version file..."
last_commit=$(git rev-list HEAD --max-count=1 | cut -c1-7)
sed "s/\[HEAD\]/$last_commit/g" ./app/version.js > v.js && mv v.js ./app/version.js

# Do not update node modules
# echo "Updating any node modules..."
# cd app
# npm install
# cd ..
