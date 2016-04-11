'use strict';

self.addEventListener('push', function(event) {
  console.log('Push message', event);
  var notTitle = 'HomeOnNode';
  var notBody = 'Something happened!';
  var notIcon = 'images/athome-192.png';
  var notTag = 'my-tag';
  if (event.data) {
    var data = {};
    try {
      data = event.data.json();
    } catch (ex) {
      console.log('Push Event Listener failed:', ex);
    }
    notTitle = data.title || 'HomeOnNode';
    notBody = data.body || 'Something happened!';
    notIcon = data.icon || 'images/athome-192.png';
    notTag = data.tag || 'my-tag';
  }
  event.waitUntil(
    self.registration.showNotification(notTitle, {
      body: notBody,
      icon: notIcon,
      tag: notTag
    }));
});
