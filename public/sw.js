// Minimal service worker so the admin can be installed as an app.
// It deliberately caches nothing: the admin must always show live data.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', () => {});
