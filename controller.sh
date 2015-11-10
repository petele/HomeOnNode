#!/bin/bash

cd app

node getConfig.js HomeOnNode
echo ""
node appController.js
echo ""
echo "HomeOnNode exited."

read -n 1 -p "Automatic reboot in 5 seconds, press any key to cancel." -s -t 5 srb
if [ $? -ge 1 ]; then
  echo -e "\nAutomatic reboot!"
  sudo reboot
  exit
fi
echo -e "\nAutomatic reboot cancelled."
