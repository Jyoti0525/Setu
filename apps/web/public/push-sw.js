// Web Push in the service worker (TODO P4.31): show the one generic line the server sends; tap opens Setu.
self.addEventListener('push', (e) => {
  let d = { title: 'Setu', body: '', url: '/' };
  try { d = { ...d, ...e.data.json() }; } catch { /* plain text or empty */ }
  e.waitUntil(self.registration.showNotification(d.title, { body: d.body, icon: '/setu-learning-bridge.png', badge: '/setu-learning-bridge.png', data: { url: d.url }, tag: 'setu-ready' }));
});
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  e.waitUntil(self.clients.matchAll({ type: 'window' }).then((cs) => (cs[0] ? cs[0].focus() : self.clients.openWindow(e.notification.data?.url ?? '/'))));
});
