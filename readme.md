

## Setup

### Update/Upgrade system

1. `sudo apt-get -y update`
1. `sudo apt-get -y upgrade`


### Install Required Packages

`sudo apt-get -y install alsa-utils mpg321 mplayer git-core lynx netatalk python-setuptools python-dev python-rpi.gpio bluetooth bluez-utils libbluetooth-dev libcap2-bin`

### Install Node

1. `wget http://node-arm.herokuapp.com/node_latest_armhf.deb`
1. `sudo dpkg -i node_latest_armhf.deb`
1. `rm node_latest_armhf.deb`

### Setup Bluetooth
Enable Bluetooth without root

* `find -path '*noble*Release/hci-ble' -exec sudo setcap cap_net_raw+eip '{}' \;`

### Clone Repo

1. `git clone https://github.com/petele/HomeOnNode.git`
1. `cd HomeOnNode/app`
1. `mkdir logs`
1. `npm install`
1. Update `Keys.js`

### Set up log rotation

1. Edit `/etc/logrotate.conf` and add:

		"/users/pi/HomeOnNode/app/logs/rpi-system.log" {
		  rotate 4
		  weekly
		  missingok
		  nocompress
		}
