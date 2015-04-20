cp ./Configs/frontdoor.json ./Remote/config.json

cd Remote


echo Getting latest keyboard commands...
rm ./Remote/config.json
cp ./Configs/frontdoor.json ./Remote/config.json

echo Exporting pin 23 and pulling up
gpio-admin export 23 pullup

cd Remote

echo Updating any node modules...
npm install

echo Starting app...
OUTPUT=$(node app.js 2>&1 >/dev/tty)
echo "${OUTPUT}"
echo "${OUTPUT}" > last_failure.txt
