#!/bin/sh

echo "#!/bin/sh" > ~/update.sh
echo "sudo apt-get -y update" >> ~/update.sh
echo "sudo apt-get -y upgrade" >> ~/update.sh
chmod +x ~/update.sh

./update.sh

echo "echo Hello!" > login.sh
chmod +x login.sh

apt-get -y install alsa-utils mpg321 mplayer git-core lynx netatalk python-setuptools python-dev python-rpi.gpio install bluetooth bluez-utils libbluetooth-dev

wget http://node-arm.herokuapp.com/node_latest_armhf.deb
sudo dpkg -i node_latest_armhf.deb
rm node_latest_armhf.deb

git clone https://github.com/petele/HomeOnNode.git
cd HomeOnNode/app
mkdir logs
npm install
