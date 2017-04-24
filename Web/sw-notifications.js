'use strict';

self.addEventListener('push', function(event) {
  console.log('Push message', event);
  let title = 'HomeOnNode';
  let body = 'An unknown event has occured, Eep!';
  let icon = '/images/athome-192.png';
  let tag = 'HoN-generic';
  let badge = '/images/ic_home_black_2x_web_48dp.png';
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
      body = data.body;
    }
    if (data.icon) {
      icon = data.icon;
    }
    if (data.tag) {
      tag = data.tag;
    }
    if (data.badge) {
      badge = data.badge;
    }
  }
  event.waitUntil(
    self.registration.showNotification(title, {
      body: body,
      icon: icon,
      tag: tag,
      badge: badge,
    }));
});
