# Raspberry Pi Headless Setup

## Create & configure the SD card

1. Use the [Raspberry Pi Imager][imager] to create a _Raspberry Pi OS Lite_
   SD card.
1. Mount the SD card.
1. Enable SSH by creating an empty file named `ssh` in the _boot_ partition
   of the SD card. ([source][ssh-setup])
1. Configure the wireless network by dropping the `wpa_supplicant.conf` file
   into the boot partition of the SD card. ([source][wireless-setup])
1. Unmount SD card from computer, and boot Raspberry Pi.

## Initial Configuration

1. SSH into `raspberrypi`, username: _pi_ password: _raspberry_
1. Run `sudo raspi-config`
   1. Run _Update_ to update to the latest `raspi-config` tool.
   1. Set _System Options_, including password, hostname, and auto-login.
   1. Set _Display Options_, including screen blanking.
   1. Set _Performance Options_, including Fan, and GPU Memory (16).
   1. Set _Localization Options_.
   1. Set _Advanced Options_, including Expand File System.
   1. Exit & reboot.
   1. SSH into Raspberry Pi using new hostname & password.

### Disable HDMI CEC (optional)

1. Disable CEC commands via HDMI. ([source][video-config])

      `echo "hdmi_ignore_cec=1" | sudo tee -a /boot/config.txt`
1. Disable CEC active source message being sent during bootup.

      `echo "hdmi_ignore_cec_init=1" | sudo tee -a /boot/config.txt`

### Edit dotfiles

1. Create `.bash_prompt`
1. Add `source .bash_prompt` to bottom of `.bashrc`

## Harden security on system

1. Follow steps at <https://www.raspberrypi.org/documentation/configuration/security.md>

**Note:** If you switch username, you'll need to edit the dotfiles again.

### Enable SSH access via key

1. If you haven't already, create an SSH key on the remote computer with:

      `ssh-keygen`
1. From the remote computer, copy key to account on the Pi:

      `ssh-copy-id pi@HOSTNAME`
1. SSH into the Pi and disable password authentication:

      `echo "PasswordAuthentication no" | sudo tee -a /etc/ssh/sshd_config`

## Update and install required software

### Update existing software

1. `sudo apt -y update && sudo apt -y full-upgrade`

### Install additional packages

1. `sudo apt -y install git git-core`
1. `sudo apt -y install lynx netatalk libssl-dev sshfs wiringpi`
1. `sudo apt -y install alsa-utils mpg321 mplayer`
1. `sudo apt -y install bluetooth bluez libbluetooth-dev libudev-dev`
1. `sudo apt -y install libavahi-compat-libdnssd-dev libcap2-bin libtool-bin`
1. (optional) `sudo apt -y install python-setuptools python-dev python-rpi.gpio`
1. (optional) `sudo apt -y install android-tools-adb`

### Install Node via NVM

1. Install [`nvm`][nvm-install]
1. Add NVM to path:

    `source ./.bashrc`
1. Install a current version of Node:

    `nvm install 14`
1. (optional) Install _forever_:

    `npm install -g forever`

## Enable Bluetooth (optional)

1. `find -path '*noble*Release/hci-ble' -exec sudo setcap cap_net_raw+eip '{}' \;`
1. ``sudo setcap cap_net_raw+eip $(eval readlink -f `which node`)``

[imager]: https://www.raspberrypi.org/documentation/installation/installing-images/README.md
[ssh-setup]: https://www.raspberrypi.org/documentation/remote-access/ssh/README.md
[wireless-setup]: https://www.raspberrypi.org/documentation/configuration/wireless/headless.md
[nvm-install]: https://github.com/creationix/nvm
[video-config]: https://www.raspberrypi.org/documentation/configuration/config-txt/video.md
