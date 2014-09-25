var Client = require('castv2').Client;
var log = require("./SystemLog");


function Chromecast(ip) {
  var connected = false;
  var requestId = 1;
  var appId = "3625CFA5";
  var client, heartbeatId, connection, heartbeat, receiver;

  this.startApp = function() {
    if (connected === true) {
      this.stopApp();
    }

    client = new Client();
    client.connect(ip, function() {

      connected = true;

      // create various namespace handlers
      connection = client.createChannel('sender-0', 'receiver-0', 'urn:x-cast:com.google.cast.tp.connection', 'JSON');
      heartbeat  = client.createChannel('sender-0', 'receiver-0', 'urn:x-cast:com.google.cast.tp.heartbeat', 'JSON');
      receiver   = client.createChannel('sender-0', 'receiver-0', 'urn:x-cast:com.google.cast.receiver', 'JSON');

      // establish virtual connection to the receiver
      connection.send({ type: "CONNECT" });

      // start heartbeating
      heartbeatId = setInterval(function() {
        heartbeat.send({ type: "PING" });
      }, 5000);

      // launch the specified app
      receiver.send({ type: "LAUNCH", appId: appId, requestId:  requestId});
      requestId++;

      // display receiver status updates
      receiver.on("message", function(data, broadcast) {
        log.debug("[CHROMECAST Receiver] " + data.toString());
      });

      log.log("[CHROMECAST] Connected.");
    });
  };

  this.stopApp = function() {
    log.log("[CHROMECAST] Disconnect.")
    if (heartbeatId) {
      clearInterval(heartbeatId);
      heartbeatId = null;
      heartbeat = null;
    }
    if (receiver) {
      receiver.send({type: "STOP", requestId: requestId});
      requestId++;
      receiver = null;
    }
    if (connection) {
      connection.send({type: "CLOSE", requestId: requestId});
      requestId++;
      connection = null;
    }
    connected = false;
  }

  log.init("[CHROMECAST]");
}

module.exports = Chromecast;
