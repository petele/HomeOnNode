var EventEmitter = require("events").EventEmitter;
var util = require("util");
var XMPP = require("node-xmpp");
var log = require("./SystemLog");


function Harmony(ip, uuid) {
  var _ip = ip;
  var _uuid = uuid;
  var _connectionString = {
    jid: uuid + "@connect.logitech.com/gatorade.",
    password: uuid,
    host: _ip,
    domain: "@connect.logitech.com/gatorade."
  };
  var client;
  var _self = this;
  this.currentActivity = -1;
  var reconnect = true;

  function connect() {
    client = new XMPP.Client(_connectionString);
    client.on("error", handleError);
    client.on("online", handleOnline);
    client.on("stanza", handleStanza);
    client.on("offline", handleOffline);
    client.on("connect", handleConnect);
    client.on("reconnect", handleReconnect);
    client.on("disconnect", handleDisconnect);
    //client.connection.reconnect = true;
    log.debug("[HARMONY] connect.");
  }

  function handleError(err) {
    _self.emit("error", err);
  }

  function handleOnline(connection) {
    log.debug("[HARMONY] Online.");
    _self.emit("ready");
    keepAlive();
  }

  function handleStanza(data) {
    var result;
    //console.log("R", data);
    if (data.children.length >= 1) {
      var child = data.children[0];
      //console.log("-R", child.name, child["attrs"]);
      if (child["attrs"]["mime"] === "vnd.logitech.harmony/vnd.logitech.harmony.engine?config") {
        result = child.children.join("");
        result = JSON.parse(result);
        _self.emit("config", result);
        log.debug("[HARMONY] handleStanza(log)");
      } else if (child["attrs"]["mime"] === "vnd.logitech.harmony/vnd.logitech.harmony.engine?getCurrentActivity") {
        result = child.children.join("");
        result = result.split("=");
        _self.emit("activity", result[1]);
        _self.currentActivity = result[1];
        log.debug("[HARMONY] handleStanza(getCurrentActivity) " + result[1]);
      } else if (child["attrs"]["type"] === "harmony.engine?startActivityFinished") {
        result = child.children.join("");
        result = result.split(":");
        for (var i = 0; i < result.length; i++) {
          if (result[i].indexOf("activityId") === 0) {
            result = result[i].split("=");
            _self.emit("activity", result[1]);
            _self.currentActivity = result[1];
            log.debug("[HARMONY] handleStanza(startActivityFinished) " + result[1]);
            break;
          }
        } // for loop
      } // else statements
    } // no children

  }

  function handleOffline() {
    log.debug("[HARMONY] Offline.");
    if (reconnect) {
      connect();
    }
    //console.log("-OFFLINE");
  }

  function handleConnect(connection) {
    log.debug("[HARMONY] Connected.");
    //console.log("-CONNECT", a, b);
  }

  function handleReconnect(a, b) {
    log.debug("[HARMONY] Reconnected.");
    //console.log("-RECONNECT", a, b);
  }

  function handleDisconnect(a, b) {
    log.debug("[HARMONY] Disconnected.");
    //console.log("-DISCONNECT", client.connection.reconnect);
  }

  function keepAlive() {
    //log.debug("[HARMONY] KeepAlive");
    if (client !== undefined) {
      var cmd = new XMPP.Element("iq", {"id": _uuid});
      client.send(cmd);
    }
    setTimeout(function() {
      if (reconnect) {
        keepAlive();
      }
    }, 15*1000);
  }

  this.getConfig = function(callback) {
    if (client === undefined) {
      _self.emit("error", "Client not connected.");
    } else {
      log.debug("[HARMONY] getConfig.");
      var cmd = new XMPP.Element("iq", {"id": _uuid})
        .c("oa", {
          "xmlns": "connect.logitech.com",
          "mime": "vnd.logitech.harmony/vnd.logitech.harmony.engine?config"
        });
      var r = client.send(cmd);
      if (callback) {
        callback(r);
      }
    }
  };

  this.getActivity = function(callback) {
    if (client === undefined) {
      _self.emit("error", "Client not connected.");
    } else {
      log.debug("[HARMONY] getActivity.");
      var cmd = new XMPP.Element("iq", {"id": _uuid})
        .c("oa", {
          "xmlns": "connect.logitech.com",
          "mime": "vnd.logitech.harmony/vnd.logitech.harmony.engine?getCurrentActivity"
        });
      var r = client.send(cmd);
      if (callback) {
        callback(r);
      }
    }
  };

  this.setActivity = function(activityID, callback) {
    if (client === undefined) {
      _self.emit("error", "Client not connected.");
    } else {
      log.debug("[HARMONY] setActivity.");
      var cmdText = "activityId=" + activityID.toString() + ":timestamp=0";
      var cmd = new XMPP.Element("iq", {"id": _uuid, "type": "get"})
        .c("oa", {
          "xmlns": "connect.logitech.com",
          "mime": "harmony.engine?startactivity"
        }).t(cmdText);
      var r = client.send(cmd);
      if (callback) {
        callback(r);
      }
    }
  };

  this.turnOff = function(callback) {
    if (client === undefined) {
      _self.emit("error", "Client not connected.");
    } else {
      log.debug("[HARMONY] turnOff.");
      if (this.currentActivity !== -1) {
        this.setActivity(-1, callback);
      }
    }
  };

  this.close = function() {
    if (client === undefined) {

    } else {
      log.debug("[HARMONY] close()");
      //client.connection.reconnect = false;
      reconnect = false;
      client.end();
      client = undefined;
    }
  };

  connect();

}

util.inherits(Harmony, EventEmitter);

// Harmony.prototype.find = function() {
//   this.emit("error", "Not yet implemented");
// }


module.exports = Harmony;
