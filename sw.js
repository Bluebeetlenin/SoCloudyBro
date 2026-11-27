self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(clients.claim()));

self.addEventListener('notificationclick', e => {
  e.notification.close();
  const convoKey = e.notification.data && e.notification.data.convoKey;
  e.waitUntil(clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
    const win = list[0];
    if (!win) return clients.openWindow('/');
    if (convoKey) win.postMessage({ type: 'open-chat', convoKey });
    return win.focus();
  }));
});
