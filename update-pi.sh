#!/bin/sh

echo "Updating pi..."
sudo apt -y update
apt list --upgradable > ~/upgrade-list.txt
sudo apt -y full-upgrade
