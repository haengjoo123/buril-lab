// Older prompt-mode clients only subscribe to reload after a worker waits.
// autoUpdate skips that state, so migrate those open clients once from the SW.
(() => {
  const cacheName = 'burillab-pwa-migrations-v1';
  const marker = new URL('__legacy_auto_update_v1__', self.registration.scope).href;

  self.addEventListener('install', (event) => {
    const isUpdate = Boolean(self.registration.active);
    event.waitUntil((async () => {
      const cache = await caches.open(cacheName);
      if (!await cache.match(marker)) {
        await cache.put(marker, new Response(isUpdate ? 'pending' : 'done'));
      }
    })());
  });

  self.addEventListener('activate', (event) => {
    event.waitUntil((async () => {
      const cache = await caches.open(cacheName);
      if (await (await cache.match(marker))?.text() !== 'pending') return;

      // Persist before navigation to prevent refresh loops across worker restarts.
      await cache.put(marker, new Response('done'));
      await self.clients.claim();
      const windows = await self.clients.matchAll({ type: 'window' });
      for (const client of windows.filter((client) => {
        const url = new URL(client.url);
        return url.origin === self.location.origin
          && !/^\/(?:api(?:\/|$)|cdn-cgi(?:\/|$)|release\.json$|sw\.js$)/.test(url.pathname);
      })) {
        // Navigation fetches wait for activation to finish. Awaiting navigate()
        // here would keep activation waiting for its own navigation forever.
        void client.navigate(client.url).catch(() => {});
      }
    })());
  });
})();
