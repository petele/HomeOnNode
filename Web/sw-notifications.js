'use strict';

self.addEventListener('push', function(event) {
  // eslint-disable-next-line no-console
  console.log('[PUSH] Message received', event);
  let title = 'HomeOnNode';
  const opts = {
    body: 'An unknown event has occured, Eep!',
    icon: '/images/athome-192.png',
    tag: `HoN-local-${Date.now()}`,
    badge: '/images/ic_home_black_2x_web_48dp.png',
    vibrate: [500, 100, 150],
  };

  let data;
  try {
    data = event.data.json();
  } catch (ex) {
    console.error('[PUSH] Unabled to jsonify data:', ex);
  }

  if (data && typeof data === 'object') {
    if (data.title) {
      title = data.title;
    }
    if (data.body) {
      opts.body = data.body;
    }
    if (data.icon) {
      opts.icon = data.icon;
    }
    if (data.tag) {
      opts.tag = data.tag;
    }
    if (data.badge) {
      opts.badge = data.badge;
    }
    if (data.requireInteraction) {
      opts.requireInteraction = true;
    }
    if (data.renotify) {
      opts.renotify = true;
    }
    if (data.silent) {
      opts.silent = true;
    }
    if (data.vibrate) {
      opts.vibrate = data.vibrate;
    }
  }

  // eslint-disable-next-line no-console
  console.log('[PUSH] Show notification', {title, opts});
  const result = self.registration.showNotification(title, opts);
  event.waitUntil(result);
});
