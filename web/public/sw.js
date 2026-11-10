// Shelfhelp's service worker. It keeps the app's own files (scripts, styles, fonts, icons)
// so the installed app opens quickly, and shows a short "can't reach Shelfhelp" page when
// the server is unreachable. Pages and everything under /api/ always come from the server,
// so nothing shown in the app is ever out of date.
const CACHE = "shelfhelp-assets-v1";

const OFFLINE_PAGE = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#111827"><title>Shelfhelp</title>
<style>
  html,body{margin:0;height:100%;background:#111827;color:#e5e7eb;font-family:system-ui,-apple-system,sans-serif}
  main{min-height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;padding:24px;text-align:center;box-sizing:border-box}
  h1{margin:0;font-size:22px;color:#fff}
  p{margin:0;max-width:320px;color:#9ca3af;font-size:15px;line-height:1.5}
  button{margin-top:8px;border:1px solid #6366f1;background:#4f46e5;color:#fff;border-radius:6px;padding:10px 18px;font-size:15px}
</style></head>
<body><main>
  <h1>Can't reach Shelfhelp</h1>
  <p>Check your connection, or the server may be restarting. Try again in a moment.</p>
  <button onclick="location.reload()">Try again</button>
</main></body></html>`;

self.addEventListener("install", () => self.skipWaiting());

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys()) if (key !== CACHE) await caches.delete(key);
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith("/api/")) return;

  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req).catch(() => new Response(OFFLINE_PAGE, { status: 503, headers: { "Content-Type": "text/html; charset=utf-8" } })),
    );
    return;
  }

  // Built files have a content hash in their name, so a stored copy is always the right one.
  if (url.pathname.startsWith("/assets/")) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(CACHE);
        const hit = await cache.match(req);
        if (hit) return hit;
        const res = await fetch(req);
        // Only keep real answers, never a sign-in page or redirect.
        if (res.ok && res.type === "basic" && !res.redirected) cache.put(req, res.clone());
        return res;
      })(),
    );
  }
});
