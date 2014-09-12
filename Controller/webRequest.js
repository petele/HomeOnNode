var http = require("http");
var https = require("https");
var log = require("./SystemLog");


function makeRequest(uri, body, callback) {
  var request;
  var options = {
    hostname: uri.host,
    path: uri.path
  };
  if (uri.port) {
    options.port = uri.port;
  }
  if (uri.method) {
    options.method = uri.method;
  }
  if (body) {
    options.headers = {
      "Content-Type": "application/json",
      "Content-Length": body.length
    }
  }

  function handleResponse(response) {
    var result = "";
    response.setEncoding("utf8");
    response.on("data", function(chunk) {
      result += chunk
    });
    response.on("end", function() {
      if (callback) {
        try {
          callback(JSON.parse(result));
        } catch (ex) {
          log.error("[WEBREQUEST] Response Error: " + ex);
          callback({"error": ex});
        }
      }
    });
  }

  if (uri.secure) {
    request = https.request(options, handleResponse);
  } else {
    request = http.request(options, handleResponse);
  }
  request.on("error", function(error) {
    log.error("[WEBREQUEST] Request Error: " + error);
    if (callback) {
      callback({"error": error});
    }
  });
  request.setTimeout(2500, function() {
    log.warn("[WEBREQUEST] Timeout Exceeded");
    request.abort();
  });
  if (body) {
    request.write(body);
  }
  request.end();
}


exports.request = makeRequest;
