'use strict';

var Keys = require('../app/Keys').keys.firebase;
var Firebase = require('firebase');
var readline = require('readline');

var fb, rl;

function init() {
  console.log('Add Person for Presence Tracking...');
  rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });
  var fbURL = 'https://' + Keys.appId + '.firebaseio.com';
  fb = new Firebase(fbURL);
  fb.authWithCustomToken(Keys.key, function(error) {
    if(error) {

    } else {
      ask();
    }
  });
}

function ask() {
  rl.question('Name: ', function(ansName) {
    if (ansName.trim() === 'quit') {
      rl.close();
      process.exit();
    } else {
      rl.question('UUID: ', function(ansUUID) {
        addPerson(ansName.trim(), ansUUID.trim(), true);
      });
    }
  });
}

function addPerson(name, uuid, track) {
  var person = {
    'name': name,
    'uuid': uuid,
    'track': track
  };
  var ref = fb.child('config/presence/people').push(person);
  console.log('+ User:', name, 'added. (' + ref.key() + ')');
  console.log('Type \'quit\' to quit.');
  ask();
}


init();
