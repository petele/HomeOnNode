var EventEmitter = require("events").EventEmitter;
var util = require("util");
var https = require("https");
var log = require("./SystemLog");

function Dropcam(username, password, uuid) {
  var self = this;
  var isStreaming;
  var authToken;
  var cameraSettings;

  function makeRequest(options, body, callback) {
    var request;
    options.hostname = "www.dropcam.com";
    options.headers = {
      "Referer": "https://www.dropcam.com"
    };
    if (authToken) {
      options.headers["Cookie"] = authToken;
    }
    if (body) {
      options.headers["Content-Type"] = "application/x-www-form-urlencoded"
      options.headers["Content-Length"] = body.length;
    }
    function handleResponse(response) {
      var result = "";
      response.setEncoding("utf8");
      response.on("data", function(chunk) {
        result += chunk;
      });
      response.on("end", function() {
        if (callback) {
          try {
            result = JSON.parse(result);
            callback(response.statusCode, result);
          } catch (ex) {
            callback(-1, ex);
          }
        }
      });
    }
    request = https.request(options, handleResponse);
    request.on("error", function(err) {
      if (callback) {
        callback(-1, err);
      }
    });
    if (body) {
      request.write(body);
    }
    request.end();
  }

  function getAuthToken(callback) {
    var body = "username=[[USERNAME]]&password=[[PASSWORD]]";
    body = body.replace("[[USERNAME]]", username);
    body = body.replace("[[PASSWORD]]", password);
    var uri = {
      method: "POST",
      path: "/api/v1/login.login",
    };
    makeRequest(uri, body, function(respCode, resp) {
      if (respCode === 200) {
        if (resp.status === 0) {
          authToken = "website_2=" + resp.items[0].session_token + ";";
          log.debug("[Dropcam] AuthToken: " + authToken);
          self.emit("ready");
        } else {
          self.emit("error", resp);
        }
      } else {
        self.emit("error", resp);
      }
    });
  }

  this.getCamera = function(callback) {
    var uri = {
      method: "GET",
      path: "/api/v1/dropcams.get_properties?uuid=" + uuid
    };
    makeRequest(uri, undefined, function(respCode, resp) {
      if ((respCode === 200) && (callback)) {
        if (resp.status === 0) {
          callback(null, resp.items[0]);
        } else {
          callback(resp, null);
        }
      } else if (callback) {
        callback(resp, null);
      }
    });
  }

  this.enableCamera = function(enabled, callback) {
    var body = "uuid=[[UUID]]&key=streaming.enabled&value=[[ENABLED]]";
    body = body.replace("[[UUID]]", uuid);
    body = body.replace("[[ENABLED]]", enabled.toString());
    var uri = {
      method: "POST",
      path: "/api/v1/dropcams.set_property",
    };
    log.debug("[Dropcam] Enabled: " + enabled.toString());
    makeRequest(uri, body, function(respCode, resp) {
      if ((respCode === 200) && (callback)) {
        if (resp.status === 0) {
          callback(null, resp.items[0]);
        } else {
          callback(resp, null);
        }
      } else if (callback) {
        callback(resp, null);
      }
    });
  }

  function updateCameraState() {
    self.getCamera(function(err, camera) {
      try {
        if (camera["streaming.enabled"] !== isStreaming) {
          isStreaming = camera["streaming.enabled"];
          self.emit("change", {"streaming": isStreaming});
        }
      } catch (ex) {
        log.error("[Dropcam] Unable to update camera state.");
        console.log(camera);
      }
    });
  }

  function init() {
    log.init("[Dropcam] " + uuid);
    getAuthToken(function() {
      updateCameraState();
    });
    setInterval(updateCameraState, 1000*60*2);
  }

  init();
}

util.inherits(Dropcam, EventEmitter);

module.exports = Dropcam;
