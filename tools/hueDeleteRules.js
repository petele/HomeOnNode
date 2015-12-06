'use strict';

var Keys = require('../app/Keys').keys;
var wr = require('../app/webRequest');
var log = require('../app/SystemLog');
log.setDebug(false);
log.setLogfile(null);

function handleResponse(result) {
  console.log(result);
}

var hubIP = '10.0.0.210';
var basePath = '/api/' + Keys.hueBridge.key + '/rules/';


var rules = 48;

function deleteRule() {
  setTimeout(function() {
    var rule = rules--;
    console.log('Deleting rule #', rule);
    var uri = {host: hubIP, path: basePath + rule, method: 'DELETE'};
    wr.request(uri, null, handleResponse);
    if (rule >= 0) {
      deleteRule();
    }
  }, 200);
}

deleteRule();