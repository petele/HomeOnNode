'use strict';

var fs = require('fs');
var log = require('./SystemLog');
var Keys = require('./Keys').keys.firebase;
var Firebase = require('firebase');

var fbURL = 'https://' + Keys.appId + '.firebaseio.com/';
var fb = new Firebase(fbURL);

function init() {
	log.appStart('getConfig', false);
	fb.authWithCustomToken(Keys.key, function(error, authToken) {
		if (error) {
			log.exception('[getCONFIG] Auth Error', error);
			process.exit(1);
		}
		log.log('Requesting config file...');
		fb.child('config').once('value', function(snapshot) {
			log.log('Config file received.');
			var config = snapshot.val();
			fs.writeFileSync('config.json', JSON.stringify(config, null, 2));
			log.log('Config file saved.')
			process.exit(0);
		});
	});

	setTimeout(function() {
		log.error('Timeout exceeded.');
		process.exit(1);
	}, 30000);
}

init();