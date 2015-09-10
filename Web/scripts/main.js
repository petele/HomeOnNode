/* jshint browser: true */
/* global Firebase, fbKey, fbAppId */
'use strict';

window.lastEvent = Date.now();

var primaryPanel = document.querySelector('primary-panel');
var pages = document.querySelector('core-animated-pages');
var pToast = document.querySelector('paper-toast');
var pErrorToast = document.querySelector('error-toast');
var ignoreError = true;

var fbURL = 'https://' + fbAppId + '.firebaseio.com';
var fb = new Firebase(fbURL);
fb.authWithCustomToken(fbKey, function(error) {
  if (error) {
    console.error('[FIREBASE] Auth failed. ' + error.toString());
    window.showErrorToast('Firebase authentication failure.');
  } else {
    console.log('[FIREBASE] Auth success.');
    fb.child('.info/connected').on('value', function(snapshot) {
      if (snapshot.val() === true) {
        window.showToast('Firebase connected.');
      } else {
        window.showErrorToast('Network disconnected.');
      }
    });
    fb.child('logs/errors').limitToLast(1).on('child_added', function(snapshot) {
      if (ignoreError === true) {
        ignoreError = false;
      } else {
        var err = snapshot.val();
        if (err.device === 'controller') {
          window.showErrorToast(err.message);
        }
      }
    });
  }
});

window.showErrorToast = function(message) {
  if (pToast.opened === true) {
    pToast.dismiss();
  }
  if (message.length > 60) {
    message = message.substring(0, 59) + '...';
  }
  pErrorToast.text = message;
  pErrorToast.show();
  if (navigator.vibrate) {
    navigator.vibrate([300, 100, 100]);
  }
};

window.showToast = function(message) {
  pToast.text = message;
  pToast.show();
};

window.getCommands = function(commands, filter) {
  var result = [];
  var keys = Object.keys(commands);
  for (var i = 0; i < keys.length; i++) {
    var key = keys[i];
    var command = commands[key];
    if (command.label) {
      command.command = key;
      if (filter) {
        if (command.kind === filter) {
          result.push(command);
        }
      } else {
        result.push(command);
      }
    }
  }
  return result;
};

window.addEventListener('popstate', function(e) {
  var state = e.state;
  console.log('Pop State', state);
  if (state) {
    if (state.panel === 'primary') {
      pages.selected = 'primary';
      primaryPanel.selectedTab = state.tab;
    } else {
      pages.selected = state.panel;
    }
  } else {
    pages.selected = 'primary';
    primaryPanel.selectedTab = 'status';
  }
  window.lastEvent = Date.now();
});

window.addEventListener('load', function(e) {
  var h = {panel: 'primary', tab: 'status', path: '/status'};
  history.replaceState(h, null, '/status');
  if (window.location.pathname === '/') {

  } else {

  }
});

//var cacheBustedUrl = 'index.html?cache-bust=' + Date.now();
//document.querySelector('#reload').href = cacheBustedUrl;
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw-offline.js');
}
