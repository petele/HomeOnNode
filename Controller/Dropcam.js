var os = require("os");
var EventEmitter = require("events").EventEmitter;
var util = require("util");
var https = require("https");
var log = require("./SystemLog");

function Dropcam(username, password, uuid) {
  var self = this;
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
        authToken = "website_2=" + resp.items[0].session_token + ";";
        log.debug("[Dropcam] AuthToken: " + authToken);
        if (callback) {
          callback(authToken);
        }
      } else {
        console.log("ERROR", body, respCode, resp);
      }
    });
  }

  this.getCamera = function(callback) {
    var uri = {
      method: "GET",
      path: "/api/v1/dropcams.get_properties?uuid=" + uuid
    };
    makeRequest(uri, undefined, callback);
  }

  this.enableCamera = function(enabled, callback) {
    var body = "uuid=[[UUID]]&key=streaming.enabled&value=[[ENABLED]]";
    body = body.replace("[[UUID]]", uuid);
    body = body.replace("[[ENABLED]]", enabled.toString());
    var uri = {
      method: "POST",
      path: "/api/v1/dropcams.set_property",
    };
    makeRequest(uri, body, callback);
  }


  function init() {
    log.init("[Dropcam] " + uuid);
    getAuthToken(function() {
      self.getCamera(function(camera) {
        self.emit("ready");
      });
    })
  }

  init();
}

util.inherits(Dropcam, EventEmitter);

module.exports = Dropcam;
