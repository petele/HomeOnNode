## Setup

### Update/Upgrade system

1. `sudo apt-get -y update`
1. `sudo apt-get -y upgrade`

### Install Required Packages

`sudo apt-get -y install alsa-utils mpg321 mplayer git-core lynx netatalk python-setuptools python-dev python-rpi.gpio bluetooth bluez libbluetooth-dev libcap2-bin libudev-dev libusb-1.0-0-dev libpcap-dev`

### Install Node 0.12

1. `wget http://node-arm.herokuapp.com/node_latest_armhf.deb`
1. `sudo dpkg -i node_latest_armhf.deb`
1. `rm node_latest_armhf.deb`

### Install Z-Wave

1. Follow instructions from [OpenZWaveShared](https://github.com/OpenZWave/node-openzwave-shared/blob/master/README-raspbian.md)
1. `sudo ldconfig`

### Clone Repo

1. `git clone https://github.com/petele/HomeOnNode.git`
1. `cd HomeOnNode/app`
1. `mkdir logs`
1. `npm install`
1. Update `Keys.js`

### Setup Bluetooth
Enable Bluetooth without root

* `find -path '*noble*Release/hci-ble' -exec sudo setcap cap_net_raw+eip '{}' \;`

### Disable screen blanking

Edit `/etc/kbd/config` and set:

1. `BLANK_TIME=0`
1. `BLANK_DPMS=off`
1. `POWERDOWN_TIME=0`

### Set up log rotation

1. Edit `/etc/logrotate.conf` and add:

		"/users/pi/HomeOnNode/app/logs/rpi-system.log" {
		  rotate 4
		  weekly
		  missingok
		  nocompress
		}

Celebrate!


### Other notes and resources:

#### Interesting projects
* [HomeAssistant](https://github.com/balloob/home-assistant/)
* [Node Sonos](https://github.com/bencevans/node-sonos)

#### Harmony Info
* [Protocol Guide 1](https://github.com/jterrace/pyharmony/blob/master/PROTOCOL.md)
* [Protocol Guide 2](https://github.com/swissmanu/harmonyhubjs-client/tree/master/docs/protocol)

