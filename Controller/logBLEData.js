var noble = require("noble");
var fs = require("fs");
var readline = require("readline");
var mac;
var result = [];

// = "e4b9ad53b9754435a10217c6f05b6e87";

result.push("uuid,rssi,JSDate,NiceDate");

var rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

rl.question("UUID to watch: ", function(answer) {
  if (answer.trim().length > 0) {
    mac = answer.trim().toUpperCase();
  } else {
    mac = "*";
  }
  noble.startScanning([], true);
});

noble.on('discover', function(peripheral) {
  if ((mac === "*") || (peripheral.uuid.toUpperCase() === mac)) {
    var line = peripheral.uuid + "," + peripheral.rssi;
    line = line + "," + Date.now() + "," + new Date();
    console.log(line);
    result.push(line);
  }
});

process.on('SIGINT', function() {
  noble.stopScanning();
  var msg = result.join("\n");
  fs.appendFileSync("./ble-discovery.csv", msg + "\n");
  process.exit();
});