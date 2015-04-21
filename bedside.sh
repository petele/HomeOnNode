echo Getting latest keyboard commands...
rm ./Remote/config.json
cp ./Configs/bedside.json ./Remote/config.json

cd Remote

echo Updating any node modules...
npm install

echo Starting app...
OUTPUT=$(node app.js 2>&1 >/dev/tty)
echo "${OUTPUT}"
echo "${OUTPUT}" > last_failure.txt
