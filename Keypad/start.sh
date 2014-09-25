#!/bin/sh

check_exit_code() {
  if [ "${1}" -eq "0" ]; then
    echo "Normal exit."
  elif [ "${1}" -eq "10" ]; then
    echo "Reboot requested."
    sudo reboot
  else
    echo "Unknown exit code: ${1}"
    echo "${1}" >> exitcodes.txt
  fi
}

echo Resetting any local file changes...
git reset --hard

echo Getting latest version...
git pull

echo Creating lastest version file...
last_commit=$(git rev-list HEAD --max-count=1 | cut -c1-7)
sed "s/\[HEAD\]/$last_commit/g" ../Controller/version.js > v.js && mv v.js ../Controller/version.js

echo Getting latest keyboard commands...
rm ./keypad.json
cp ../KeypadConfigs/bedside.json ./keypad.json

echo Updating any node modules...
npm install

echo Starting app...
node app.js

# node temp.js

check_exit_code $?


