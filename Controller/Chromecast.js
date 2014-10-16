var Client = require('castv2').Client;
var log = require("./SystemLog");


function Chromecast(ip) {
  var connected = false;
  var requestId = 1;
  var defaultAppId = "3625CFA5";
  var client, heartbeatId, connection, heartbeat, receiver;

  this.startApp = function(applicationId) {
    var appId = applicationId || defaultAppId;
    if (connected === true) {
      this.stopApp();
    }

    try {
      client = new Client();
      client.on("error", function(e) {
        log.exception("[ChromeCast] Client error", e);
      });
      client.connect(ip, function() {

        // create various namespace handlers
        connection = client.createChannel('sender-0', 'receiver-0', 'urn:x-cast:com.google.cast.tp.connection', 'JSON');
        heartbeat  = client.createChannel('sender-0', 'receiver-0', 'urn:x-cast:com.google.cast.tp.heartbeat', 'JSON');
        receiver   = client.createChannel('sender-0', 'receiver-0', 'urn:x-cast:com.google.cast.receiver', 'JSON');

        connection.on("error", function(e) {
          log.exception("[ChromeCast] Connection error", e);
        });
        heartbeat.on("error", function(e) {
          log.exception("[ChromeCast] Heartbeat error", e);
        });
        receiver.on("error", function(e) {
          log.exception("[ChromeCast] Receiver error", e);
        });

        // establish virtual connection to the receiver
        connection.send({ type: "CONNECT" });

        // start heartbeating
        heartbeatId = setInterval(function() {
          try {
            heartbeat.send({ type: "PING" });
          } catch (ex) {
            log.exception("[ChromeCast] Unable to send heartbeat ping.", ex);
          }
        }, 5000);

        // launch the specified app
        receiver.send({ type: "LAUNCH", appId: appId, requestId:  requestId});
        requestId++;

        // display receiver status updates
        receiver.on("message", function(data, broadcast) {
          log.debug("[ChromeCast Receiver] " + JSON.stringify(data));
        });

        connected = true;

        log.log("[ChromeCast] Started App [" + appId + "]");
      });
    } catch (ex) {
      this.stopApp();
      log.exception("[ChromeCast] Exception when starting app [" + appId + "]", ex);
    }
    return connected;
  };

  this.stopApp = function() {
    var success = true;

    try {
      if (heartbeatId) {
        clearInterval(heartbeatId);
        heartbeatId = null;
        heartbeat = null;
        log.debug("[ChromeCast] Heartbeat stopped.");
      }
    } catch (ex) {
      success = false;
      log.exception("[ChromeCast] Error stopping heartbeat.", ex);
    }

    try {
      if (receiver) {
        receiver.send({type: "STOP", requestId: requestId});
        requestId++;
        receiver = null;
        log.debug("[ChromeCast] Receiver stopped.");
      }
    } catch (ex) {
      success = false;
      log.exception("[ChromeCast] Error stopping receiver.", ex);
    }

    try {
      if (connection) {
        connection.send({type: "CLOSE", requestId: requestId});
        requestId++;
        connection = null;
        log.debug("[ChromeCast] Connection closed.");
      }
    } catch (ex) {
      success = false;
      log.exception("[ChromeCast] Error closing connection.", ex);
    }

    connected = false;
    log.log("[ChromeCast] App Stopped.");
    return success;
  };

  log.init("[ChromeCast]");
}

module.exports = Chromecast;
