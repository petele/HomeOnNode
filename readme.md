# Home On Node

My home automation framework.

## Setup

To setup a new Raspberry Pi, follow the [Raspberry Pi Headless Setup][pi-setup]
instructions.

[pi-setup]: https://github.com/petele/HomeOnNode/blob/main/RPi-Setup.md

## Setup Flic

Follow instructions at <https://community.home-assistant.io/t/install-flic/16969/4>

### Clone Repo

1. `git clone https://github.com/petele/HomeOnNode.git`
1. `cd HomeOnNode/app`
1. `mkdir logs`
1. `npm i onoff`
1. Update `Keys.js`
1. `cp ../login.sh ~`

### Set up log rotation

Edit `/etc/logrotate.conf` and add:

```text
"/users/pi/HomeOnNode/app/logs/rpi-system.log" {
  rotate 4
  weekly
  missingok
  nocompress
}
```

## Set `login.sh` to run automatically

1. Edit `~/login.sh` and have it start whatever is necessary.
1. Edit `.bashrc` and add `./login.sh` to the bottom of the file.

Celebrate!

### Other notes and resources

#### Interesting projects

* [HomeAssistant](https://github.com/balloob/home-assistant/)
* [Node Sonos](https://github.com/bencevans/node-sonos)

#### Harmony Info

* [Protocol Guide 1](https://github.com/jterrace/pyharmony/blob/master/PROTOCOL.md)
* [Protocol Guide 2](https://github.com/swissmanu/harmonyhubjs-client/tree/master/docs/protocol)

## No longer used

### Install Z-Wave

1. Install USB stuff for z-wave
       `sudo apt-get -y install libcap2-bin libudev-dev libusb-1.0-0-dev libpcap-dev`
1. Follow instructions from
   [OpenZWaveShared](https://github.com/OpenZWave/node-openzwave-shared/blob/master/README-raspbian.md)
1. `sudo ldconfig`
1. `git clone https://github.com/OpenZWave/open-zwave`
