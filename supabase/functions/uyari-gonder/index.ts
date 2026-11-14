// @ts-nocheck — düz JavaScript olarak yazıldı; tür denetimi kapalı
// TusDostum · bildirim gönderici (Supabase Edge Function)
// Her dakika zamanlanmış görev tarafından çağrılır (supabase/cron.sql). Vakti gelen mola / çalışma uyarılarını
// veritabanından alır ve kişinin kayıtlı cihazlarına Web Push bildirimi yollar.
// Dış kütüphane kullanmaz: şifreleme (RFC 8291, aes128gcm) ve VAPID imzası (RFC 8292) WebCrypto ile yapılır.
//
// Gerekli gizli değerler (Supabase → Edge Functions → Secrets):
//   CRON_GIZLI   : cron.sql içindeki değerle aynı uzun rastgele metin
//   VAPID_ACIK   : anahtar.html sayfasının verdiği açık anahtar (config.js'tekiyle aynı)
//   VAPID_OZEL   : anahtar.html sayfasının verdiği özel anahtar (yalnızca burada durur)
//   VAPID_KONU   : "mailto:adresin@ornek.com" (bildirim servislerinin sorun olursa ulaşacağı adres)
// SUPABASE_URL ve sunucu anahtarı (SUPABASE_SECRET_KEYS ya da eski SUPABASE_SERVICE_ROLE_KEY) Supabase tarafından
// kendiliğinden sağlanır. Bulunamazsa gizli değerlere SERVIS_ANAHTARI adıyla "secret" anahtarı elle eklenebilir.
// Bu işlev için "Verify JWT" kapatılmalıdır; yetki CRON_GIZLI ile denetlenir.

const enc = new TextEncoder();
const b64uEnc = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const b64uDec = (s) => {
  let t = String(s).trim().replace(/-/g, "+").replace(/_/g, "/");
  t += "=".repeat((4 - (t.length % 4)) % 4);
  return Uint8Array.from(atob(t), (c) => c.charCodeAt(0));
};
const ekle = (...parcalar) => {
  const o = new Uint8Array(parcalar.reduce((n, p) => n + p.length, 0));
  let i = 0;
  for (const p of parcalar) { o.set(p, i); i += p.length; }
  return o;
};
async function hkdf(salt, ikm, info, uzunluk) {
  const key = await crypto.subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"]);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt, info }, key, uzunluk * 8));
}

// İletiyi alıcının anahtarlarıyla şifreler (aes128gcm içerik kodlaması)
export async function sifrele(duzMetin, p256dh, auth) {
  const aliciAcik = b64uDec(p256dh), gizli = b64uDec(auth);
  const aliciKey = await crypto.subtle.importKey("raw", aliciAcik, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const gecici = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  const geciciAcik = new Uint8Array(await crypto.subtle.exportKey("raw", gecici.publicKey));
  const ortak = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: aliciKey }, gecici.privateKey, 256));
  const ikm = await hkdf(gizli, ortak, ekle(enc.encode("WebPush: info\0"), aliciAcik, geciciAcik), 32);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(salt, ikm, enc.encode("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdf(salt, ikm, enc.encode("Content-Encoding: nonce\0"), 12);
  const key = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["encrypt"]);
  const sifreli = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, key, ekle(duzMetin, new Uint8Array([2]))));
  const bas = new Uint8Array(21 + geciciAcik.length);
  bas.set(salt, 0);
  new DataView(bas.buffer).setUint32(16, 4096);
  bas[20] = geciciAcik.length;
  bas.set(geciciAcik, 21);
  return ekle(bas, sifreli);
}

// Gönderenin kimliğini kanıtlayan VAPID başlığı
export async function vapidYetki(endpoint, vapid, simdi = Date.now()) {
  const acik = b64uDec(vapid.acik);
  if (acik.length !== 65 || acik[0] !== 4) throw new Error("VAPID_ACIK geçersiz");
  const jwk = { kty: "EC", crv: "P-256", x: b64uEnc(acik.slice(1, 33)), y: b64uEnc(acik.slice(33, 65)), d: b64uEnc(b64uDec(vapid.ozel)), ext: true };
  const key = await crypto.subtle.importKey("jwk", jwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const bas = b64uEnc(enc.encode(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const yuk = b64uEnc(enc.encode(JSON.stringify({ aud: new URL(endpoint).origin, exp: Math.floor(simdi / 1000) + 12 * 3600, sub: vapid.konu })));
  const imza = new Uint8Array(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, enc.encode(`${bas}.${yuk}`)));
  return `vapid t=${bas}.${yuk}.${b64uEnc(imza)}, k=${b64uEnc(acik)}`;
}

export async function pushGonder(abone, metin, vapid, fetchFn = fetch) {
  const govde = await sifrele(enc.encode(metin), abone.p256dh, abone.auth);
  const r = await fetchFn(abone.endpoint, {
    method: "POST",
    headers: { Authorization: await vapidYetki(abone.endpoint, vapid), "Content-Encoding": "aes128gcm", "Content-Type": "application/octet-stream", TTL: "600", Urgency: "high" },
    body: govde,
  });
  return { durum: r.status, oldu: r.status >= 200 && r.status < 300, olu: r.status === 404 || r.status === 410 };
}

// Yalnızca başlık: kısa ve tek satır (iPhone altına kendisi "from TusDostum" ekler)
export const METIN = {
  mola: () => ({ baslik: "⏰ Mola bitti!", govde: "" }),
  calisma: () => ({ baslik: "☕ Mola zamanı", govde: "" }),
  sinir: () => ({ baslik: "⚠️ 3 saat doldu", govde: "" }),
};

// Vakti gelen uyarıları al, gönder, ölü abonelikleri temizle
export async function calistir(env, fetchFn = fetch, bekleMs = 1500) {
  // Yeni tür gizli anahtar (sb_secret_…) yalnızca "apikey" başlığında gider; eski tür (JWT) ayrıca Authorization ister
  const eskiTur = /^eyJ/.test(String(env.anahtar || ""));
  const rpc = (ad, govde) => fetchFn(`${env.url}/rest/v1/rpc/${ad}`, {
    method: "POST",
    headers: { apikey: env.anahtar, ...(eskiTur ? { Authorization: `Bearer ${env.anahtar}` } : {}), "Content-Type": "application/json" },
    body: JSON.stringify(govde || {}),
  });
  // Sunucu güncellenirken kuyruk bir an okunamayabilir: bildirim bir dakika gecikmesin diye iki kez daha denenir
  let r = await rpc("td_vadesi_gelenler");
  for (let i = 0; i < 2 && !r.ok; i++) { await new Promise((c) => setTimeout(c, bekleMs)); r = await rpc("td_vadesi_gelenler"); }
  if (!r.ok) throw new Error(`kuyruk okunamadı (${r.status})`);
  const satirlar = await r.json();
  const sonuc = { gonderilen: 0, basarisiz: 0, silinen: 0 };
  const olu = [];
  await Promise.all((satirlar || []).map(async (s) => {
    const sira = Number(s.sira) || 0;
    const m = (METIN[s.tur] || METIN.mola)(s.dk, sira);
    try {
      // her tekrar ayrı etiketle gider: telefon bir öncekinin üstüne sessizce yazmaz, her seferinde ses çıkarır
      const g = await pushGonder(s, JSON.stringify({ baslik: m.baslik, govde: m.govde, etiket: `td-${s.tur}-${sira}`, url: "./" }), env.vapid, fetchFn);
      if (g.oldu) sonuc.gonderilen++; else { sonuc.basarisiz++; if (g.olu) olu.push(s.endpoint); }
    } catch (_e) { sonuc.basarisiz++; }
  }));
  // Tebrik ve dürtme bildirimleri (yalnızca ortak odadakilerden; çalışan kişiye tebrik bildirimi zaten kuyruğa girmez)
  const e = await rpc("td_bekleyen_etkilesimler");
  if (e.ok) {
    const etk = await e.json().catch(() => []);                    // beklenmedik yanıtta mola uyarıları yine gitsin
    await Promise.all((Array.isArray(etk) ? etk : []).map(async (s) => {
      const m = ETKILESIM_METIN(s);
      try {
        const g = await pushGonder(s, JSON.stringify({ baslik: m, govde: "", etiket: `td-${s.tur}-${s.id}`, url: "./" }), env.vapid, fetchFn);
        if (g.oldu) sonuc.gonderilen++; else { sonuc.basarisiz++; if (g.olu) olu.push(s.endpoint); }
      } catch (_e) { sonuc.basarisiz++; }
    }));
  }
  if (olu.length) { await rpc("td_olu_abonelikleri_sil", { p_endpointler: [...new Set(olu)] }); sonuc.silinen = new Set(olu).size; }
  return sonuc;
}
// Haftalık özet (Pazar akşamı): "📊 Bu hafta 32 sa 10 dk · geçen haftadan 4 sa fazla"
const sureYaz = (dk) => { const h = Math.floor(dk / 60), m = Math.round(dk % 60); return h && m ? `${h} sa ${m} dk` : h ? `${h} sa` : `${m} dk`; };
export const HAFTALIK_METIN = (bu, gecen) => {
  const fark = bu - gecen;
  if (!(gecen > 0)) return `📊 Bu hafta ${sureYaz(bu)} çalıştın`;
  if (Math.abs(fark) < 10) return `📊 Bu hafta ${sureYaz(bu)} · geçen haftayla aynı`;
  return `📊 Bu hafta ${sureYaz(bu)} · geçen haftadan ${sureYaz(Math.abs(fark))} ${fark > 0 ? "fazla" : "az"}`;
};
// yalniz: yalnızca bu kişiye (deneme için)
export async function haftalik(env, fetchFn = fetch, yalniz = "") {
  const eskiTur = /^eyJ/.test(String(env.anahtar || ""));
  const rpc = (ad, govde) => fetchFn(`${env.url}/rest/v1/rpc/${ad}`, {
    method: "POST",
    headers: { apikey: env.anahtar, ...(eskiTur ? { Authorization: `Bearer ${env.anahtar}` } : {}), "Content-Type": "application/json" },
    body: JSON.stringify(govde || {}),
  });
  const r = await rpc("td_haftalik_ozet");
  if (!r.ok) throw new Error(`haftalık özet okunamadı (${r.status})`);
  const satirlar = (await r.json().catch(() => [])) || [];
  const sonuc = { gonderilen: 0, basarisiz: 0, silinen: 0 };
  const olu = [];
  await Promise.all((Array.isArray(satirlar) ? satirlar : []).filter((s) => !yalniz || s.uid === yalniz).map(async (s) => {
    try {
      const g = await pushGonder(s, JSON.stringify({ baslik: HAFTALIK_METIN(Number(s.bu_hafta) || 0, Number(s.gecen_hafta) || 0), govde: "", etiket: "td-hafta", url: "./" }), env.vapid, fetchFn);
      if (g.oldu) sonuc.gonderilen++; else { sonuc.basarisiz++; if (g.olu) olu.push(s.endpoint); }
    } catch (_e) { sonuc.basarisiz++; }
  }));
  if (olu.length) { await rpc("td_olu_abonelikleri_sil", { p_endpointler: [...new Set(olu)] }); sonuc.silinen = new Set(olu).size; }
  return sonuc;
}
export const ETKILESIM_METIN = (s) => s.tur === "tebrik"
  ? `👏 ${s.gonderen_ad || "Bir arkadaşın"} seni tebrik etti`
  : `👋 ${s.gonderen_ad || "Bir arkadaşın"} seni dürttü${s.oda_ad ? " · " + s.oda_ad : ""}`;

// Sunucu anahtarı: elle verilen SERVIS_ANAHTARI → Supabase'in sağladığı yeni tür (SUPABASE_SECRET_KEYS) → eski tür
export function sunucuAnahtari(oku) {
  const elle = oku("SERVIS_ANAHTARI");
  if (elle) return elle.trim();
  const ham = oku("SUPABASE_SECRET_KEYS");
  if (ham) {
    try {
      const j = JSON.parse(ham);
      const deger = (v) => (typeof v === "string" ? v : v && (v.api_key || v.key || v.value || v.secret));
      if (typeof j === "string") return j;
      if (Array.isArray(j)) { const d = deger(j.find((x) => x && x.name === "default") || j[0]); if (d) return d; }
      else if (j && typeof j === "object") { const d = deger(j.default !== undefined ? j.default : Object.values(j)[0]); if (d) return d; }
    } catch (_e) { if (/^sb_secret_/.test(ham.trim())) return ham.trim(); }
  }
  return oku("SUPABASE_SERVICE_ROLE_KEY");
}

// deno-lint-ignore no-explicit-any
const D = (globalThis as any).Deno;
if (D && D.serve) {
  D.serve(async (req) => {
    const gizli = D.env.get("CRON_GIZLI") || "";
    if (!gizli || req.headers.get("x-cron-gizli") !== gizli) return new Response("yetkisiz", { status: 401 });
    try {
      const url = D.env.get("SUPABASE_URL");
      const env = {
        url,
        anahtar: sunucuAnahtari((ad) => D.env.get(ad)),
        vapid: { acik: D.env.get("VAPID_ACIK"), ozel: D.env.get("VAPID_OZEL"), konu: D.env.get("VAPID_KONU") || url },
      };
      let istek = {};
      try { istek = await req.json(); } catch (_e) { istek = {}; }
      const sonuc = istek && istek.haftalik ? await haftalik(env, fetch, typeof istek.yalniz === "string" ? istek.yalniz : "") : await calistir(env);
      return new Response(JSON.stringify(sonuc), { headers: { "Content-Type": "application/json" } });
    } catch (e) {
      return new Response(String((e && e.message) || e), { status: 500 });
    }
  });
}
