// Web Push in the service worker (TODO P4.31): show the one generic line the server sends; tap opens Setu.
self.addEventListener('push', (e) => {
  let d = { title: 'Setu', body: '', url: '/' };
  try { d = { ...d, ...e.data.json() }; } catch { /* plain text or empty */ }
  e.waitUntil(self.registration.showNotification(d.title, { body: d.body, icon: '/icon-192.png', badge: '/icon-192.png', data: { url: d.url }, tag: d.url === '/' ? 'setu-ready' : 'setu-teacher' }));
});
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  e.waitUntil(self.clients.matchAll({ type: 'window' }).then((cs) => (cs[0] ? cs[0].navigate(e.notification.data?.url ?? '/').then((c) => c?.focus()) : self.clients.openWindow(e.notification.data?.url ?? '/'))));
});
