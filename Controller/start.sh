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
    ./error.sh
  fi
}

echo Setting Up Thermometer...
sudo modprobe w1-gpio
sudo modprobe w1-therm

echo Resetting any local file changes...
git reset --hard

echo Getting latest version...
git pull

echo Creating lastest version file...
last_commit=$(git rev-list HEAD --max-count=1 | cut -c1-7)
sed "s/\[HEAD\]/$last_commit/g" version.js > v.js && mv v.js version.js

echo Getting latest keyboard commands...
rm ./keypad.json
cp ../KeypadConfigs/primary.json ./keypad.json

echo Updating any node modules...
npm install

echo Exporting pin 23 and pulling up
# gpio-admin export 23 pullup

echo Starting app...
node app.js

# node temp.js

check_exit_code $?


