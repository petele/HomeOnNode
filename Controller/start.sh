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

git reset --hard
git pull
npm install
sudo node app.js

# node temp.js

check_exit_code $?


