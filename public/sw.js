/* Adflix service worker.
 *
 * Registration only: being registered at all is half of what makes the app
 * installable. It deliberately caches nothing — every poster, thumbnail and
 * video here is adult media, and a cached copy would outlive the session that
 * was allowed to see it. Playback is Range requests against /api/videos, which
 * a worker easily answers wrongly (broken seeking), so all requests go straight
 * to the network, as if no worker existed.
 */

self.addEventListener("install", () => self.skipWaiting());

self.addEventListener("activate", (event) =>
  event.waitUntil(
    (async () => {
      // Drop any cache an earlier worker on this origin may have left behind.
      for (const name of await caches.keys()) await caches.delete(name);
      await self.clients.claim();
    })()
  )
);
