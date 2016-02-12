'use strict';

console.log('sw-notifications 11');

self.addEventListener('push', function(event) {
  console.log('Push message', event);
  var title = 'HomeOnNode';
  event.waitUntil(
    self.registration.showNotification(title, {
      body: 'Something happened!',
      icon: 'images/athome-192.png',
      tag: 'my-tag'
    }));
});
