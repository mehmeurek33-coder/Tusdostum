// TusDostum · servis çalışanı: çevrimdışı kabuk + bildirimler
const SURUM = "td-2";
const KABUK = ["./", "index.html", "config.js", "altyapi.js", "vendor/supabase.js", "manifest.webmanifest",
  "icons/icon-192.png", "icons/icon-512.png", "icons/apple-touch-icon.png"];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(SURUM).then(c => c.addAll(KABUK)).catch(() => {}).then(() => self.skipWaiting()));
});
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== SURUM).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

// Önce ağ (güncel sürüm hemen gelsin), ağ yoksa önbellek. Yazı tipleri önbellekten.
self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  const yaziTipi = url.hostname === "fonts.googleapis.com" || url.hostname === "fonts.gstatic.com";
  if (url.origin !== self.location.origin && !yaziTipi) return;     // Supabase istekleri olduğu gibi geçer
  if (yaziTipi) {
    e.respondWith(caches.open(SURUM).then(async c => {
      const hit = await c.match(req);
      if (hit) return hit;
      const res = await fetch(req);
      if (res && (res.ok || res.type === "opaque")) c.put(req, res.clone());
      return res;
    }));
    return;
  }
  e.respondWith((async () => {
    const c = await caches.open(SURUM);
    try {
      const res = await fetch(req);
      if (res && res.ok) c.put(req, res.clone());
      return res;
    } catch (err) {
      const hit = (await c.match(req, { ignoreSearch: true })) || (req.mode === "navigate" ? await c.match("index.html") : null);
      if (hit) return hit;
      throw err;
    }
  })());
});

self.addEventListener("push", e => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch { d = { govde: e.data ? e.data.text() : "" }; }
  const baslik = d.baslik || "TusDostum";
  e.waitUntil(self.registration.showNotification(baslik, {
    body: d.govde || "",
    tag: d.etiket || "tusdostum",
    renotify: true,
    requireInteraction: true,                                       // dokunulana kadar ekranda kalsın (destekleyen telefonlarda)
    silent: false,
    icon: "icons/icon-192.png",
    badge: "icons/badge-96.png",
    vibrate: [400, 150, 400, 150, 400],
    data: { url: d.url || "./" },
  }));
});

self.addEventListener("notificationclick", e => {
  e.notification.close();
  const hedef = new URL((e.notification.data && e.notification.data.url) || "./", self.registration.scope).href;
  e.waitUntil((async () => {
    const pencereler = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const p of pencereler) if (p.url.startsWith(self.registration.scope) && "focus" in p) return p.focus();
    return self.clients.openWindow(hedef);
  })());
});
