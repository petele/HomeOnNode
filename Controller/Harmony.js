var EventEmitter = require("events").EventEmitter;
var util = require("util");
var XMPP = require("node-xmpp");


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
  }

  function handleError(err) {
    _self.emit("error", err);
  }

  function handleOnline(connection) {
    console.log("-ONLINE", connection);
    _self.emit("ready");
  }

  function handleStanza(data) {
    if (data.children.length === 1) {
      var payload = data.children[0];
      var text;
      if (payload["errorcode"] === "200") {
        if (payload["attrs"]["mime"] === "vnd.logitech.harmony/vnd.logitech.harmony.engine?config") {
          text = payload["children"].join("");
          console.log("-CONFIG");
          _self.emit("config", text);
        } else if (payload["attrs"]["type"] === "harmony.engine?startActivityFinished") {
          text = payload["children"];
          console.log("-ACTIVITY STARTED");
          _self.emit("change", text);
        } else {
          console.log("-UNKNOWN MESSAGE", payload);
        }
      } else {
        console.log("-ERROR READING STANZA");
        _self.emit("error", payload["errorcode"]);
      }
    } else if (data.children.length === 0) {
      _self.emit("error", "Stanza has no children.");
      console.log("-Stanza has no children", data);
    } else {
      _self.emit("error", "Stanza has more than 1 child.");
      console.log("-Stanza has more than one child.", data);
    }
  }

  function handleOffline(a, b) {
    console.log("-OFFLINE", a, b);
  }

  function handleConnect(a, b) {
    console.log("-CONNECT", a, b);
  }

  function handleReconnect(a, b) {
    console.log("-RECONNECT", a, b);
  }

  function handleDisconnect(a, b) {
    console.log("-DISCONNECT", a, b);
  }

  this.getConfig = function(callback) {
    if (client === undefined) {
      _self.emit("error", "Client not connected.");
    } else {
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
      var cmdText = "activityId=" + activityID.toString() + ":timestamp=0";
      var cmd = new XMPP.Element("iq", {"id": _uuid})
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
      if (this.currentActivity !== -1) {
        this.setActivity(-1, callback);
      }
    }
  };

  this.close = function() {
    if (client === undefined) {

    } else {
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
