// TusDostum · altyapı katmanı (GitHub Pages + Supabase)
// Uygulamanın beklediği dört parçayı (db, user, room, downloads) Supabase üzerinde sağlar.
// Uygulama kodu bu dosyayı window.claude.use(...) ve window.TusAltyapi üzerinden kullanır.
(function () {
  "use strict";
  const cfg = window.TUSDOSTUM_AYAR || {};
  const dolu = v => typeof v === "string" && v.trim() && !/BURAYA/i.test(v);
  const hazir = dolu(cfg.supabaseUrl) && dolu(cfg.supabaseAnahtar) && !!(window.supabase && window.supabase.createClient);
  const sb = hazir ? window.supabase.createClient(cfg.supabaseUrl.trim(), cfg.supabaseAnahtar.trim(), {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    realtime: { params: { eventsPerSecond: 5 } },
  }) : null;

  const hata = (code, message) => { const e = new Error(message || code); e.code = code; return e; };
  // Supabase hatasını uygulamanın anladığı koda çevir
  function cevir(error) {
    if (!error) return null;
    const msg = String(error.message || ""), c = String(error.code || "");
    if (/td_boyut/.test(msg)) return hata("quota_exceeded", msg);
    if (c === "42501" || /row-level security|permission denied|td_engelli/i.test(msg)) return hata("not_permitted", msg);
    return hata("unavailable", msg);
  }
  const kopya = v => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
  const nesne = v => !!v && typeof v === "object" && !Array.isArray(v);
  // Sunucudaki td_birlestir ile aynı kural: nesneler iç içe birleşir, diziler ve düz değerler değişir, null alanı siler
  function birlestir(a, b) {
    if (!nesne(a) || !nesne(b)) return kopya(b);
    const r = { ...a };
    for (const k of Object.keys(b)) {
      const v = b[k];
      if (v === null) delete r[k];
      else if (nesne(v) && nesne(r[k])) r[k] = birlestir(r[k], v);
      else r[k] = kopya(v);
    }
    return r;
  }

  // ---------- Oturum ----------
  let uid = null, eposta = "";
  let kurtarma = false;                                             // şifre sıfırlama bağlantısıyla gelindi
  const kurtarmaDinleyen = [];
  if (sb) sb.auth.onAuthStateChange((olay, ses) => {
    if (olay === "PASSWORD_RECOVERY") { kurtarma = true; kurtarmaDinleyen.forEach(f => { try { f(); } catch {} }); }
    if (olay === "SIGNED_OUT" && uid) location.reload();
    if (ses && ses.user && uid && ses.user.id !== uid) location.reload();
  });
  async function oturum() {
    if (!sb) return null;
    const { data } = await sb.auth.getSession();
    const ses = data && data.session;
    if (!ses || !ses.user) return null;
    uid = ses.user.id; eposta = ses.user.email || "";
    return { id: uid, eposta };
  }
  const TR_HATA = [
    [/invalid login credentials/i, "E-posta ya da şifre yanlış."],
    [/already registered|already been registered/i, "Bu e-posta ile bir hesap var. Giriş yap."],
    [/password should be at least|weak password/i, "Şifre en az 6 karakter olmalı."],
    [/unable to validate email|invalid email|email address .* invalid/i, "Geçerli bir e-posta yaz."],
    [/email not confirmed/i, "E-postana gelen onay bağlantısına bas, sonra giriş yap."],
    [/not authorized|email_address_not_authorized|error sending/i, "E-posta gönderilemiyor. Şifreni yöneticiden sıfırlamasını iste."],
    [/rate limit|too many/i, "Çok fazla deneme oldu. Biraz sonra tekrar dene."],
    [/signups? (are )?(not allowed|disabled)/i, "Yeni kayıt şu an kapalı."],
    [/failed to fetch|network/i, "Bağlantı kurulamadı."],
  ];
  const trHata = e => { const m = String((e && e.message) || ""); const f = TR_HATA.find(x => x[0].test(m)); return f ? f[1] : "İşlem yapılamadı. Tekrar dene."; };
  const geriAdres = () => location.origin + location.pathname;
  async function girisYap(email, sifre) {
    const { error } = await sb.auth.signInWithPassword({ email, password: sifre });
    if (error) throw hata("auth", trHata(error));
    return oturum();
  }
  async function kayitOl(email, sifre) {
    const { data, error } = await sb.auth.signUp({ email, password: sifre, options: { emailRedirectTo: geriAdres() } });
    if (error) throw hata("auth", trHata(error));
    if (!data || !data.session) throw hata("onay", "E-postana onay bağlantısı gönderildi. Bağlantıya basıp giriş yap.");
    return oturum();
  }
  async function googleIle() {
    const { error } = await sb.auth.signInWithOAuth({ provider: "google", options: { redirectTo: geriAdres() } });
    if (error) throw hata("auth", trHata(error));
  }
  async function sifreSifirla(email) {
    const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: geriAdres() });
    if (error) throw hata("auth", trHata(error));
  }
  async function yeniSifre(sifre) {
    const { error } = await sb.auth.updateUser({ password: sifre });
    if (error) throw hata("auth", trHata(error));
    kurtarma = false;
  }
  async function cikis() {
    try { await bildirim.kapat(); } catch {}
    const u = uid; uid = null;                                      // SIGNED_OUT olayında çift yenileme olmasın
    try { await sb.auth.signOut(); } catch {}
    if (u) location.reload();
  }

  // ---------- Veri ----------
  // Ortak alan: profiller (ad, simge, canlı kronometre, bugünün oturumları) herkese açık;
  //   son_gunler (son 10 gün) yalnızca aynı kişisel odadakilere; oda_uyeleri oda adlarının özetini tutar (ad gizli kalır).
  // Özel alan: ozel_belgeler yalnızca sahibine.
  const prof = new Map(), son = new Map(), ozel = new Map();
  let uyeler = [];                                                  // [{uid, oda(özet)}]
  let odalarim = { etiketler: [], anahtarlar: [], ozetler: [] };
  const TABLOLAR = ["profiller", "son_gunler", "oda_uyeleri", "odalarim", "ozel_belgeler"];
  const yuklendi = new Set();
  const ortakHazir = () => ["profiller", "son_gunler", "oda_uyeleri", "odalarim"].every(t => yuklendi.has(t));
  const ozelHazir = () => yuklendi.has("ozel_belgeler");
  let bekleyen = 0;
  const bekleyenYol = {};
  const ortakDinleyen = new Set(), ozelDinleyen = new Set();
  const odaKoduOf = lab => (api.odaKodu ? api.odaKodu(lab) : String(lab).toLowerCase());

  function digerOdalar(u) {                                          // başkasının odaları: ortak olanlar benim etiketimle, diğerleri tanınmaz bir adla
    const out = [];
    for (const r of uyeler) {
      if (r.uid !== u) continue;
      const i = odalarim.ozetler.indexOf(r.oda);
      out.push(i >= 0 ? odalarim.etiketler[i] : "~h-" + String(r.oda).slice(0, 16));
    }
    return out;
  }
  function kokBelge(u) {
    const veri = prof.get(u); if (!veri) return null;
    const rooms = u === uid ? odalarim.etiketler.slice() : digerOdalar(u);
    const d = { ...veri, rooms, room: rooms[0] || "genel" };
    if (son.has(u)) d.son = son.get(u);
    return d;
  }
  const anlik = (ids, oku, hazirMi) => ({
    docs: ids.map(id => ({ id, exists: true, data: () => kopya(oku(id)) })),
    metadata: { fromCache: !hazirMi, hasPendingWrites: bekleyen > 0 },
  });
  const ortakAnlik = () => anlik([...prof.keys()], kokBelge, ortakHazir());
  const ozelAnlik = () => anlik([...ozel.keys()], id => ozel.get(id), ozelHazir());
  let yayT = { ortak: 0, ozel: 0 };
  function yay(hangi) {
    clearTimeout(yayT[hangi]);
    yayT[hangi] = setTimeout(() => {
      const set = hangi === "ortak" ? ortakDinleyen : ozelDinleyen;
      const snap = hangi === "ortak" ? ortakAnlik() : ozelAnlik();
      set.forEach(f => { try { f(snap); } catch (e) { console.error(e); } });
    }, 0);
  }

  async function cek(tablo) {
    let q;
    if (tablo === "profiller") q = sb.from("profiller").select("uid,veri");
    else if (tablo === "son_gunler") q = sb.from("son_gunler").select("uid,son");
    else if (tablo === "oda_uyeleri") q = sb.from("oda_uyeleri").select("uid,oda");
    else if (tablo === "odalarim") q = sb.from("odalarim").select("etiketler,anahtarlar,ozetler").eq("uid", uid);
    else q = sb.from("ozel_belgeler").select("belge,veri").eq("uid", uid);
    const { data, error } = await q;
    if (error) throw error;
    const rows = data || [];
    if (tablo === "profiller") {
      const benim = bekleyenYol["logs/" + uid] ? prof.get(uid) : undefined;   // yazmam sürerken kendi satırımı ezme
      prof.clear(); rows.forEach(r => prof.set(r.uid, r.veri || {}));
      if (benim !== undefined) prof.set(uid, benim);
    } else if (tablo === "son_gunler") {
      const benim = bekleyenYol["logs/" + uid] ? son.get(uid) : undefined;
      son.clear(); rows.forEach(r => son.set(r.uid, r.son || []));
      if (benim !== undefined) son.set(uid, benim);
    } else if (tablo === "oda_uyeleri") uyeler = rows;
    else if (tablo === "odalarim") {
      if (!bekleyenYol.odalar) { const r = rows[0] || {}; odalarim = { etiketler: r.etiketler || [], anahtarlar: r.anahtarlar || [], ozetler: r.ozetler || [] }; }
    } else {
      const eski = new Map(ozel);
      ozel.clear(); rows.forEach(r => ozel.set(r.belge, r.veri || {}));
      for (const [k, v] of eski) if (bekleyenYol[`data/users/${uid}/${k}`]) ozel.set(k, v);
    }
    yuklendi.add(tablo);
    yay(tablo === "ozel_belgeler" ? "ozel" : "ortak");
  }
  const cekT = {};
  function cekSonra(tablo, ms = 120) { clearTimeout(cekT[tablo]); cekT[tablo] = setTimeout(() => cek(tablo).catch(() => tekrarDene(tablo)), ms); }
  const deneme = {};
  function tekrarDene(tablo) { deneme[tablo] = Math.min((deneme[tablo] || 0) + 1, 6); cekSonra(tablo, 1000 * 2 ** deneme[tablo]); }
  function hepsiniCek() { TABLOLAR.forEach(t => cek(t).then(() => { deneme[t] = 0; }).catch(() => tekrarDene(t))); }

  let kanal = null, basladi = false;
  function baslat() {
    if (basladi || !sb || !uid) return;
    basladi = true;
    hepsiniCek();
    kanal = sb.channel("td-veri-" + uid)
      .on("postgres_changes", { event: "*", schema: "public", table: "profiller" }, p => {
        const r = p.eventType === "DELETE" ? p.old : p.new;
        if (!r || !r.uid) { cekSonra("profiller"); return; }
        if (p.eventType === "DELETE") { prof.delete(r.uid); son.delete(r.uid); }
        else if (r.uid !== uid || !bekleyenYol["logs/" + uid]) prof.set(r.uid, r.veri || {});
        yay("ortak");
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "son_gunler" }, p => {
        const r = p.eventType === "DELETE" ? p.old : p.new;
        if (!r || !r.uid) { cekSonra("son_gunler"); return; }
        if (p.eventType === "DELETE") son.delete(r.uid);
        else if (r.uid !== uid || !bekleyenYol["logs/" + uid]) son.set(r.uid, r.son || []);
        yay("ortak");
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "oda_uyeleri" }, () => { cekSonra("oda_uyeleri"); cekSonra("son_gunler", 400); })
      .on("postgres_changes", { event: "*", schema: "public", table: "ozel_belgeler", filter: "uid=eq." + uid }, p => {
        const r = p.eventType === "DELETE" ? p.old : p.new;
        if (!r || !r.belge) { cekSonra("ozel_belgeler"); return; }
        if (bekleyenYol[`data/users/${uid}/${r.belge}`]) return;
        if (p.eventType === "DELETE") ozel.delete(r.belge); else ozel.set(r.belge, r.veri || {});
        yay("ozel");
      })
      .subscribe(durum => { if (durum === "SUBSCRIBED" && yuklendi.size) hepsiniCek(); });   // yeniden bağlanınca kaçanları al
    // Arka plandan dönünce ve aralıklarla tazele (telefonlarda canlı bağlantı sık kopar)
    document.addEventListener("visibilitychange", () => { if (!document.hidden) hepsiniCek(); });
    window.addEventListener("online", hepsiniCek);
    setInterval(() => { if (!document.hidden) ["profiller", "son_gunler", "oda_uyeleri"].forEach(t => cekSonra(t, 0)); }, 90000);
  }

  async function yaz(yol, iyimser, is) {
    bekleyen++; bekleyenYol[yol] = (bekleyenYol[yol] || 0) + 1;
    const hangi = yol.startsWith("data/") ? "ozel" : "ortak";
    try { iyimser(); yay(hangi); return await is(); }
    finally {
      bekleyen = Math.max(0, bekleyen - 1);
      bekleyenYol[yol]--; if (bekleyenYol[yol] <= 0) delete bekleyenYol[yol];
      yay(hangi);
    }
  }
  // Kök belgedeki alanları üç yere ayır: odalar (gizli), son 10 gün (oda arkadaşlarına), geri kalan (herkese açık profil)
  function ayir(body) {
    const { rooms, room, son: s, ...kalan } = body || {};
    return { rooms, sonGun: s, kalan };
  }
  async function odalariYaz(etiketler) {
    const lab = (Array.isArray(etiketler) ? etiketler : []).filter(x => typeof x === "string").slice(0, 5);
    const keys = lab.map(odaKoduOf);
    const ayni = JSON.stringify(lab) === JSON.stringify(odalarim.etiketler) && JSON.stringify(keys) === JSON.stringify(odalarim.anahtarlar);
    if (ayni && yuklendi.has("odalarim")) return;
    bekleyenYol.odalar = (bekleyenYol.odalar || 0) + 1;
    const onceki = odalarim;
    odalarim = { etiketler: lab, anahtarlar: keys, ozetler: keys.map((k, i) => (onceki.anahtarlar.indexOf(k) >= 0 ? onceki.ozetler[onceki.anahtarlar.indexOf(k)] : "?" + i)) };
    try {
      const { data, error } = await sb.rpc("td_odalari_ayarla", { p_etiketler: lab, p_anahtarlar: keys });
      if (error) { odalarim = onceki; throw cevir(error); }
      odalarim = { etiketler: lab, anahtarlar: keys, ozetler: Array.isArray(data) ? data : [] };
    } finally {
      bekleyenYol.odalar--; if (bekleyenYol.odalar <= 0) delete bekleyenYol.odalar;
      cekSonra("oda_uyeleri", 0); cekSonra("son_gunler", 300);
    }
  }
  function kokRef(u) {
    const yol = "logs/" + u;
    return {
      async get() { const d = kokBelge(u); return { id: u, exists: !!d, data: () => kopya(d) }; },
      async set(body) {
        if (u !== uid) throw hata("not_permitted");
        const { rooms, sonGun, kalan } = ayir(body);
        return yaz(yol, () => { prof.set(u, kopya(kalan)); if (sonGun !== undefined) son.set(u, kopya(sonGun) || []); }, async () => {
          const { error } = await sb.from("profiller").upsert({ uid: u, veri: kalan });
          if (error) throw cevir(error);
          if (sonGun !== undefined) { const r = await sb.from("son_gunler").upsert({ uid: u, son: sonGun || [] }); if (r.error) throw cevir(r.error); }
          if (rooms !== undefined) await odalariYaz(rooms);
        });
      },
      async update(patch) {
        if (u !== uid) throw hata("not_permitted");
        const { rooms, sonGun, kalan } = ayir(patch);
        if (yuklendi.has("profiller") && !prof.has(u)) throw hata("invalid_argument", "belge yok");
        return yaz(yol, () => { prof.set(u, birlestir(prof.get(u) || {}, kalan)); if (sonGun !== undefined) son.set(u, kopya(sonGun) || []); }, async () => {
          if (Object.keys(kalan).length) {
            const { data, error } = await sb.rpc("td_profil_guncelle", { p_yama: kalan });
            if (error) throw cevir(error);
            if (data === null) { prof.delete(u); throw hata("invalid_argument", "belge yok"); }
            if (bekleyenYol[yol] <= 1) prof.set(u, data);
          }
          if (sonGun !== undefined) { const r = await sb.from("son_gunler").upsert({ uid: u, son: sonGun || [] }); if (r.error) throw cevir(r.error); }
          if (rooms !== undefined) await odalariYaz(rooms);
        });
      },
      async delete() {
        if (u === uid) {
          return yaz(yol, () => { prof.delete(u); son.delete(u); }, async () => { const { error } = await sb.from("profiller").delete().eq("uid", u); if (error) throw cevir(error); });
        }
        // Yönetici: kişiyi listelerden çıkarır ve yeniden katılmasını engeller
        return yaz(yol, () => { prof.delete(u); son.delete(u); uyeler = uyeler.filter(r => r.uid !== u); }, async () => {
          const { error } = await sb.rpc("td_kisi_cikar", { p_uid: u });
          if (error) { cekSonra("profiller", 0); throw cevir(error); }
        });
      },
    };
  }
  function ozelRef(belge) {
    const yol = `data/users/${uid}/${belge}`;
    return {
      async get() { const v = ozel.get(belge); return { id: belge, exists: v !== undefined, data: () => kopya(v) }; },
      async set(body) {
        return yaz(yol, () => ozel.set(belge, kopya(body)), async () => {
          const { error } = await sb.from("ozel_belgeler").upsert({ uid, belge, veri: body });
          if (error) throw cevir(error);
        });
      },
      async update(patch) {
        if (ozelHazir() && !ozel.has(belge)) throw hata("invalid_argument", "belge yok");
        return yaz(yol, () => ozel.set(belge, birlestir(ozel.get(belge) || {}, patch)), async () => {
          const { data, error } = await sb.rpc("td_ozel_guncelle", { p_belge: belge, p_yama: patch });
          if (error) throw cevir(error);
          if (data === null) { ozel.delete(belge); throw hata("invalid_argument", "belge yok"); }
          if (bekleyenYol[yol] <= 1) ozel.set(belge, data);
        });
      },
      async delete() {
        return yaz(yol, () => ozel.delete(belge), async () => {
          const { error } = await sb.from("ozel_belgeler").delete().eq("uid", uid).eq("belge", belge);
          if (error) throw cevir(error);
        });
      },
    };
  }
  const bos = { async get() { return { exists: false, data: () => undefined }; }, async set() {}, async update() {}, async delete() {} };
  const db = {
    doc(path) {
      const p = String(path).split("/");
      if (p[0] === "logs" && p.length === 2) return kokRef(p[1]);
      if (p[0] === "data" && p[1] === "users" && p[2] === uid && p.length === 4) return ozelRef(p[3]);
      return bos;                                                   // eski sürümlerden kalan yollar (logs/<uid>/months/…)
    },
    collection(path) {
      const p = String(path).split("/");
      const ortak = p[0] === "logs" && p.length === 1;
      const kendi = p[0] === "data" && p[1] === "users" && p[2] === uid && p.length === 3;
      return {
        async get() { return ortak ? ortakAnlik() : kendi ? ozelAnlik() : { docs: [], metadata: { fromCache: false, hasPendingWrites: false } }; },
        onSnapshot(cb) {
          if (!ortak && !kendi) return () => {};
          baslat();
          const set = ortak ? ortakDinleyen : ozelDinleyen;
          set.add(cb);
          if (ortak ? ortakHazir() : ozelHazir()) setTimeout(() => { if (set.has(cb)) cb(ortak ? ortakAnlik() : ozelAnlik()); }, 0);
          return () => set.delete(cb);
        },
      };
    },
  };

  // ---------- Kişi ----------
  const user = {
    async me() { return { id: uid }; },
    async can() { const { data, error } = await sb.rpc("td_engelli_miyim"); return error ? true : !data; },
    async isOwner() { const { data, error } = await sb.rpc("td_yonetici_miyim"); return error ? false : !!data; },
    async profiles() { return {}; },                                 // görünen adlar profil kaydında
  };

  // ---------- Canlı oda (kim çalışıyor) ----------
  const sekme = Math.random().toString(36).slice(2, 10);
  const room = {
    async join(ad) {
      const o = { kanal: null, son: null, bagli: false, ilk: false, cb: null, gorulen: new Map(), kapali: false };
      const say = () => {
        if (!o.cb || o.kapali) return;
        const st = o.kanal.presenceState(), now = Date.now(), peers = [], canli = new Set();
        for (const key of Object.keys(st)) for (const m of st[key] || []) {
          const ref = m.presence_ref || key; canli.add(ref);
          if (!o.gorulen.has(ref)) o.gorulen.set(ref, o.ilk ? now : Math.min(now, Number(m.at) || now));
          peers.push({ kind: "viewer", peer: key, by: m.uid || null, isMe: m.uid === uid, presence: m.p || {}, updatedAt: o.gorulen.get(ref) });
        }
        for (const ref of [...o.gorulen.keys()]) if (!canli.has(ref)) o.gorulen.delete(ref);
        o.ilk = true;
        try { o.cb({ peers }); } catch (e) { console.error(e); }
      };
      const izle = () => { if (o.bagli && o.son && !o.kapali) o.kanal.track({ uid, at: Date.now(), p: o.son }).catch(() => {}); };
      o.kanal = sb.channel("oda:" + ad, { config: { presence: { key: uid + ":" + sekme } } });
      o.kanal.on("presence", { event: "sync" }, say).subscribe(durum => {
        o.bagli = durum === "SUBSCRIBED";
        if (o.bagli) { o.ilk = false; izle(); }
      });
      return {
        async presence(body) { o.son = kopya(body); izle(); },
        onPeers(cb) { o.cb = cb; if (o.bagli) say(); },
        async leave() { o.kapali = true; try { await sb.removeChannel(o.kanal); } catch {} },
      };
    },
  };

  // ---------- Dosya kaydetme (yedek) ----------
  const downloads = {
    async save({ filename, data }) {
      const tur = /\.csv$/i.test(filename) ? "text/csv" : "application/json";
      const blob = new Blob([data], { type: tur + ";charset=utf-8" });
      const telefon = (() => { try { return matchMedia("(pointer: coarse)").matches; } catch { return false; } })();
      if (telefon && navigator.canShare) {
        try {
          const dosya = new File([blob], filename, { type: tur });
          if (navigator.canShare({ files: [dosya] })) { await navigator.share({ files: [dosya], title: filename }); return; }
        } catch (e) { if (e && e.name === "AbortError") throw hata("declined"); }
      }
      const url = URL.createObjectURL(blob), a = document.createElement("a");
      a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 30000);
    },
  };

  // ---------- Bildirimler (ekran kapalıyken uyarı) ----------
  const b64 = s => { const p = s.replace(/-/g, "+").replace(/_/g, "/"); const bin = atob(p + "=".repeat((4 - p.length % 4) % 4)); return Uint8Array.from(bin, c => c.charCodeAt(0)); };
  const b64u = buf => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const bildirim = {
    destek() { return !!(sb && uid && dolu(cfg.vapidAcikAnahtar) && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window); },
    izin() { return "Notification" in window ? Notification.permission : "unsupported"; },
    kayitli: false,                                                 // bu cihaz sunucuya bildirim için kaydoldu mu
    dinleyen: [],
    degisince(f) { this.dinleyen.push(f); },
    haber() { this.dinleyen.forEach(f => { try { f(); } catch {} }); },
    acik() { return this.destek() && Notification.permission === "granted" && this.kayitli; },
    // "acik" | "sor" (izin istenebilir) | "anaEkran" (iPhone: önce ana ekrana ekle) | "reddedildi" | "yok"
    durum() {
      if (this.acik()) return "acik";
      if (this.anaEkranGerek()) return "anaEkran";
      if (!this.destek()) return "yok";
      if (Notification.permission === "denied") return "reddedildi";
      return "sor";
    },
    // iPhone'da bildirim yalnızca ana ekrana eklenmiş uygulamada çalışır
    anaEkranGerek() {
      const ios = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
      const tamEkran = (() => { try { return matchMedia("(display-mode: standalone)").matches || navigator.standalone === true; } catch { return false; } })();
      return ios && !tamEkran;
    },
    async abone() {
      const reg = await navigator.serviceWorker.ready;
      let sub = await reg.pushManager.getSubscription();
      if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64(cfg.vapidAcikAnahtar.trim()) });
      const { error } = await sb.rpc("td_abonelik_kaydet", { p_endpoint: sub.endpoint, p_p256dh: b64u(sub.getKey("p256dh")), p_auth: b64u(sub.getKey("auth")) });
      if (error) throw cevir(error);
      if (!this.kayitli) { this.kayitli = true; this.haber(); }
      return true;
    },
    // Bir dokunuşun içinden çağrılır; izin ister ve bu cihazı kaydeder
    async ac() {
      if (!this.destek()) return false;
      const izin = Notification.permission === "granted" ? "granted" : await Notification.requestPermission();
      if (izin !== "granted") return false;
      try { return await this.abone(); } catch { return false; }
    },
    async hazirla() { if (this.destek() && Notification.permission === "granted") { try { await this.abone(); } catch {} } },
    async kapat() {
      this.kayitli = false;
      if (!("serviceWorker" in navigator)) return;
      const reg = await navigator.serviceWorker.getRegistration(); if (!reg) return;
      const sub = await reg.pushManager.getSubscription(); if (!sub) return;
      try { await sb.rpc("td_abonelik_sil", { p_endpoint: sub.endpoint }); } catch {}
      try { await sub.unsubscribe(); } catch {}
    },
    // liste: [{tur:"mola"|"calisma"|"sinir", zaman: epoch ms, dk}] — sunucu vakti gelince bildirim yollar
    sonListe: "",
    async ayarla(liste) {
      if (!sb || !uid) return;
      const temiz = (liste || []).map(x => ({ tur: x.tur, zaman: Math.round(x.zaman), dk: Math.round(x.dk) || 0, tekrar: Math.round(x.tekrar) || 0 }));
      const iz = JSON.stringify(temiz);
      if (iz === this.sonListe) return;
      this.sonListe = iz;
      try { const { error } = await sb.rpc("td_uyarilari_ayarla", { p: temiz }); if (error) this.sonListe = null; } catch { this.sonListe = null; }
    },
  };

  // ---------- Servis çalışanı (çevrimdışı kabuk + bildirim) ----------
  if ("serviceWorker" in navigator && (location.protocol === "https:" || location.hostname === "localhost")) {
    window.addEventListener("load", () => { navigator.serviceWorker.register("sw.js").catch(() => {}); });
  }

  const api = window.TusAltyapi = {
    hazir, oturum, girisYap, kayitOl, googleIle, sifreSifirla, yeniSifre, cikis, bildirim,
    google: !!cfg.google,
    epostaVar: !!cfg.epostaGonderimi,                               // şifre sıfırlama e-postası gönderilebiliyor mu
    eposta: () => eposta,
    kurtarmaMi: () => kurtarma,
    kurtarmaOlunca(f) { kurtarmaDinleyen.push(f); },
    indirme: downloads,
    odaKodu: null,                                                  // uygulama açılışta kendi oda kodu işlevini buraya bağlar
    // Bu anahtarda, benden başka en az bir üyesi olan bir oda var mı? (oda adları gizli olduğu için sunucu yanıtlar)
    async odaVarMi(anahtar) {
      const { data, error } = await sb.rpc("td_oda_var_mi", { p_anahtar: anahtar });
      if (error) throw cevir(error);
      return !!data;
    },
  };
  if (hazir) {
    const parcalar = { db, user, room, downloads };
    window.claude = { use: async ad => { if (!uid) throw hata("unauthenticated"); return parcalar[ad] || null; } };
  }
})();
