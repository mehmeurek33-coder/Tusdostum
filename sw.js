// TusDostum · servis çalışanı: çevrimdışı kabuk + bildirimler
const SURUM = "td-07e271c1530c";                                              // yap.py her derlemede dosyaların özetini yazar
const KABUK = ["./", "index.html", "config.js", "altyapi.js", "vendor/supabase.js", "manifest.webmanifest",
  "icons/icon-192.png", "icons/icon-512.png", "icons/maskable-512.png", "icons/apple-touch-icon.png", "icons/badge-96.png"];

// Yeni sürüm bütün dosyalarıyla TEK PARÇA iner (biri bile inmezse kurulum olmaz, eski sürüm sürer).
// Kendiliğinden devreye girmez: uygulama, kimse çalışmıyorken "etkinles" der (kronometre çalışırken asla).
self.addEventListener("install", e => {
  e.waitUntil(caches.open(SURUM).then(c => c.addAll(KABUK.map(u => new Request(u, { cache: "reload" })))));
});
self.addEventListener("activate", e => {
  // eski sürümlerin kabuğu silinir; yazı tipleri ("td-yazitipi") sürümden bağımsızdır, silinmez
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k.startsWith("td-") && k !== SURUM && k !== "td-yazitipi").map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("message", e => { if (e.data === "etkinles") self.skipWaiting(); });

// Uygulama dosyaları: her zaman bu sürümün önbelleğinden (açık sayfa ile dosyalar hep aynı sürüm).
// Supabase istekleri ve diğer adresler olduğu gibi ağa gider. Yazı tipleri önbellekten.
const kabukYolu = url => {
  const kok = new URL("./", self.registration.scope).pathname;
  if (!url.pathname.startsWith(kok)) return null;
  const yol = url.pathname.slice(kok.length) || "index.html";
  return KABUK.includes(yol) ? yol : null;
};
self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  const yaziTipi = url.hostname === "fonts.googleapis.com" || url.hostname === "fonts.gstatic.com";
  if (yaziTipi) {
    e.respondWith(caches.open("td-yazitipi").then(async c => {
      const hit = await c.match(req);
      if (hit) return hit;
      const res = await fetch(req);
      if (res && (res.ok || res.type === "opaque")) c.put(req, res.clone());
      return res;
    }));
    return;
  }
  if (url.origin !== self.location.origin) return;
  const yol = req.mode === "navigate" ? "index.html" : kabukYolu(url);
  if (!yol) return;
  e.respondWith((async () => {
    const c = await caches.open(SURUM);
    const hit = await c.match(yol === "./" ? "index.html" : yol);
    return hit || fetch(req);
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
