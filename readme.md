## Setup

### Update/Upgrade system

1. `sudo apt-get -y update && sudo apt-get -y upgrade`


### Update settings in `raspi-config`

* Expand file system
* Set new password for `pi` user
* Enable SSH
* Change locale, keyboard layout and timezone
* Change hostname
* Force audio through 3.5mm


### Install Required Packages

1. Required for everyone:
       `sudo apt-get -y install alsa-utils mpg321 mplayer git-core lynx netatalk bluetooth bluez libbluetooth-dev`
1. Phython stuff:
       `sudo apt-get -y install python-setuptools python-dev python-rpi.gpio`
1. USB stuff for z-wave (optional):
       `sudo apt-get -y install libcap2-bin libudev-dev libusb-1.0-0-dev libpcap-dev`
1. Printer stuff (optional):
       `sudo apt-get -y install cups foomatic-db foomatic-db-engine`


### Setup Bluetooth
Enable Bluetooth without root

* `find -path '*noble*Release/hci-ble' -exec sudo setcap cap_net_raw+eip '{}' \;`


### Update/Install Node via nvm

1. `curl -o- https://raw.githubusercontent.com/creationix/nvm/v0.33.2/install.sh | bash`
2. `source ./.bashrc`
3. `nvm install 6`


### Install Forever

1. `npm install forever -g`
2. `mkdir ~/forever-logs/`


### Install Z-Wave

1. Follow instructions from
   [OpenZWaveShared](https://github.com/OpenZWave/node-openzwave-shared/blob/master/README-raspbian.md)
1. `sudo ldconfig`


### Clone Repo

1. `git clone https://github.com/petele/HomeOnNode.git`
1. `cd HomeOnNode/app`
1. `mkdir logs`
1. `npm install`
1. Update `Keys.js`
1. `cd ..`
1. `git clone https://github.com/OpenZWave/open-zwave`

**Note:** If you're going to use the GPIO pins, you'll also need to run `npm install onoff`


### Disable screen blanking

Edit `/etc/kbd/config` and set:

1. `BLANK_TIME=0`
1. `BLANK_DPMS=off`
1. `POWERDOWN_TIME=0`

Follow instructions to prevent console blanking [here](https://www.raspberrypi.org/documentation/configuration/screensaver.md)


### Set up log rotation

Edit `/etc/logrotate.conf` and add:

```
"/users/pi/HomeOnNode/app/logs/rpi-system.log" {
  rotate 4
  weekly
  missingok
  nocompress
}
```

### Create `login.sh`

1. Create `~/login.sh` with the code below
1. `chmod +x ~/login.sh`
1. Edit `.bashrc` and add `./login.sh` to the bottom of the file

```
#!/bin/bash

echo "Starting HomeOnNode in 5 seconds"
sleep 5

echo "Starting Monitor..."
forever start -l ~/forever-logs/forever.log -o ~/forever-logs/output.log -e ~/forever-logs/error.log ./HomeOnNode/monitor.json

cd HomeOnNode

./pull.sh
./get-zwave-cfg.sh
./controller.sh
```


Celebrate!


### Other notes and resources:

#### Interesting projects
* [HomeAssistant](https://github.com/balloob/home-assistant/)
* [Node Sonos](https://github.com/bencevans/node-sonos)

#### Harmony Info
* [Protocol Guide 1](https://github.com/jterrace/pyharmony/blob/master/PROTOCOL.md)
* [Protocol Guide 2](https://github.com/swissmanu/harmonyhubjs-client/tree/master/docs/protocol)

