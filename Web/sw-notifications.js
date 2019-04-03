'use strict';

self.addEventListener('push', function(event) {
  // eslint-disable-next-line no-console
  console.log('[PUSH] Message received', event);
  let title = 'HomeOnNode';
  const opts = {
    body: 'An unknown event has occured, Eep!',
    icon: '/images/athome-192.png',
    tag: 'HoN-generic',
    badge: '/images/ic_home_black_2x_web_48dp.png',
  };

  let data;
  try {
    data = event.data.json();
  } catch (ex) {
    console.error('[PUSH] Unabled to jsonify data:', ex);
  }

  if (data && data.title) {
    title = data.title;
  }
  if (data && data.body) {
    opts.body = data.body;
  }
  if (data && data.icon) {
    opts.icon = data.icon;
  }
  if (data && data.tag) {
    opts.tag = data.tag;
  }
  if (data && data.badge) {
    opts.badge = data.badge;
  }

  const promiseChain = self.registration.showNotification(title, opts)
      .then(() => {
        opts._title = title;
        // eslint-disable-next-line no-console
        console.log('[PUSH] Notification shown.', opts);
      }).catch((err) => {
        console.error('[PUSH] Unable to show notification.', err);
      });
  event.waitUntil(promiseChain);
});
