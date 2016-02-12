'use strict';

var Keys = require('../app/Keys').keys;
var Firebase = require('../app/node_modules/firebase');
var webRequest = require('../app/webRequest');
var log = require('../app/SystemLog');

var fb;

function init() {
  var fbURL = 'https://' + Keys.firebase.appId + '.firebaseio.com';
  fb = new Firebase(fbURL);
  fb.authWithCustomToken(Keys.firebase.key, function(error) {
    if(error) {

    } else {
      fb.child('pushSubscribers').on('value', function(snapshot) {
      var keys = Object.keys(snapshot.val());
      var gcmUri = {
        host: 'android.googleapis.com',
        path: '/gcm/send',
        secure: true,
        method: 'POST',
        authorization: 'key=' + Keys.gcm.apiKey
      };
      var body = {
        registration_ids: keys
      };
      webRequest.request(gcmUri, JSON.stringify(body), function(resp) {
        log.http('RESP', JSON.stringify(resp));
        process.exit(0);
      });
    });
    }
  });
}

init();
