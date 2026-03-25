// PowerPulse Service Worker — Push értesítések
const CACHE = 'pp-admin-v1';

self.addEventListener('install', e => {
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(clients.claim());
});

// Push értesítés fogadása
self.addEventListener('push', e => {
  let data = { title: '⚡ PowerPulse', body: 'Új esemény érkezett!', icon: '/icon-192.png' };
  try { data = { ...data, ...e.data.json() }; } catch(err) {}

  e.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: data.icon || '/icon-192.png',
      badge: '/icon-192.png',
      vibrate: [200, 100, 200],
      data: { url: data.url || '/admin.html' },
      actions: [
        { action: 'open', title: '📋 Megnyitás' },
        { action: 'dismiss', title: 'Bezárás' }
      ]
    })
  );
});

// Értesítésre kattintás
self.addEventListener('notificationclick', e => {
  e.notification.close();
  if (e.action === 'dismiss') return;
  const url = e.notification.data?.url || '/admin.html';
  e.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(cls => {
      const c = cls.find(c => c.url.includes('admin'));
      if (c) { c.focus(); c.navigate(url); }
      else clients.openWindow(url);
    })
  );
});
