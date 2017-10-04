## Setup

### Enable SSH

1. Run `sudo raspi-config`
1. Enable SSH
1. Change _hostname_

Now, the rest of the steps can be completed by SSH'ing into the box

### Create a new user

1. SSH into Pi
1. Create the new user:
        `sudo useradd hon -s /bin/bash -m -G adm,sudo`
1. Set the password to something complete:
        `sudo passwd hon`
1. Create any other user accounts you may need
1. Run `sudo nano /etc/sudoers` and set:
        `sudo    ALL=(ALL) NOPASSWD: ALL`
1. Log out and log back in as **hon**
1. Remove default pi account & directory:
        `sudo userdel pi && sudo rm -rf /home/pi`

### Disable SSH password authentication

1. If you haven't already, create an SSH key on the remote computer with `ssh-keygen`
1. Copy key to hon account on the Pi:
        `ssh-copy-id hon@HOSTNAME`
1. SSH into the Pi and disable password authentication:
        `echo "PasswordAuthentication no" | sudo tee -a /etc/ssh/sshd_config`

### Change default settings

#### Disable HDMI CEC & Set GPU Memory

1. `echo "hdmi_ignore_cec=1" | sudo tee -a /boot/config.txt`
1. `echo "hdmi_ignore_cec_init=1" | sudo tee -a /boot/config.txt`
1. `echo "gpu_mem=16" | sudo tee -a /boot/config.txt`


#### Disable screen saver

Edit `/etc/kbd/config` and set:

1. `BLANK_TIME=0`
1. `BLANK_DPMS=off`
1. `POWERDOWN_TIME=0`

#### Disable screen blanking

1. Disable [screen blanking](https://www.raspberrypi.org/documentation/configuration/screensaver.md)
  by editing `/boot/cmdline.txt` and adding: `consoleblank=0`

#### Update settings in `raspi-config`

* Expand file system
* Change locale, keyboard layout and timezone
* Force audio through 3.5mm

**Note:** A reboot will be required now.

### Update/Upgrade system

1. `sudo apt-get -y update && sudo apt-get -y upgrade`

### Install Required Packages

1. Required for everyone:
        `sudo apt-get -y install alsa-utils mpg321 mplayer git-core lynx netatalk bluetooth bluez libbluetooth-dev`
1. Phython stuff:
        `sudo apt-get -y install python-setuptools python-dev python-rpi.gpio`
1. USB stuff for z-wave (optional):
       `sudo apt-get -y install libcap2-bin libudev-dev libusb-1.0-0-dev libpcap-dev`


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
1. `npm install onoff`
1. Update `Keys.js`
1. `cd ..`
1. `git clone https://github.com/OpenZWave/open-zwave`


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
### Copy dotfiles

* Copy [dotfiles](https://gist.github.com/petele/000830e3ba58b47b2b487ac9566867b3)

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

