'use strict';

self.addEventListener('push', function(event) {
  console.log('Push message', event);
  var title = 'HomeOnNode';
  var notBody = 'An unknown event has occured, Eep!';
  var notIcon = '/images/athome-192.png';
  var notTag = 'unknown';
  if (event.data) {
    var data = {};
    try {
      data = event.data.json();
    } catch (ex) {
      console.log('Push Event Listener failed:', ex);
    }
    if (data.title) {
      title = data.title;
    }
    if (data.body) {
      notBody = data.body;
    }
    if (data.icon) {
      notIcon = data.icon;
    }
    if (data.tag) {
      notTag = data.tag;
    }
  }
  event.waitUntil(
    self.registration.showNotification(title, {
      body: notBody,
      icon: notIcon,
      tag: notTag,
      badge: notIcon
    }));
});
