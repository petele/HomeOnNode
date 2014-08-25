var http = require("http");


function makeRequest(options, body, callback) {
  var request = http.request(options, function(response) {
    var result = "";
    response.setEncoding('utf8');
    response.on('data', function (chunk) {
      result += chunk;
    });
    response.on("end", function() {
      if (callback) {
        try {
          callback(JSON.parse(result));
        } catch (ex) {
          callback({"error": ex});
        }
      }
    });
  });
  request.on("error", function(error) {
    if (callback) {
      callback({"error": error});
    }
  });
  request.setTimeout(2500, function() {
    request.abort();
  });

  if (body) {
    request.write(body);
  }

  request.end();
}


exports.request = makeRequest;
