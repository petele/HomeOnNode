var https = require("https");


function makeRequest(address, path, callback) {
  var options = {
    host: address,
    path: path
  };
  https.get(options, function(response) {
    var result = "";
    response.setEncoding("utf8");
    response.on("data", function(chunk) {
      result += chunk;
    });
    response.on("end", function() {
      callback(result);
    });
  }).on("error", function(error) {
    callback({"error": error});
  });
}

exports.get = makeRequest;
