// Bildirim zinciri + servis çalışanı testi (gerçek PostgreSQL, gerçek Deno işlevi, gerçek tarayıcı; yalnızca
// telefon üreticisinin bildirim servisi taklit edilir):
//   zil → izin → cihaz kaydı → "Mola ver" → sunucuda uyarı → vakti gelince Deno işlevi → şifreli ileti →
//   servis çalışanı → ekranda bildirim
// Çalıştırma:  DENO=<deno yolu> NODE_PATH="$(npm root -g):<pg ve http_ece'nin olduğu node_modules>" node test/bildirim-zinciri.js
const { chromium } = require('playwright');
const path = require('path'), crypto = require('crypto'), { spawn } = require('child_process');
const ece = require('http_ece');
const { baslat } = require('./sahte-supabase.js');
const out = [];
const ok = (ad, kosul, ek = '') => out.push(`${kosul ? 'GEÇTİ ' : 'KALDI '} ${ad}${!kosul && ek ? ' — ' + ek : ''}`);
const bekle = ms => new Promise(r => setTimeout(r, ms));
const b64u = b => Buffer.from(b).toString('base64url');

(async () => {
  const k = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const vapidAcik = b64u(await crypto.subtle.exportKey('raw', k.publicKey)), vapidOzel = (await crypto.subtle.exportKey('jwk', k.privateKey)).d;
  const S = await baslat(0, { vapid: vapidAcik });
  const alici = crypto.createECDH('prime256v1'); alici.generateKeys();
  const auth = crypto.randomBytes(16);
  const b = await chromium.launch({ channel: 'chromium' });         // tam tarayıcı: başsız kabukta bildirim izni çalışmıyor
  const ctx = await b.newContext({ viewport: { width: 390, height: 780 }, hasTouch: true });
  await ctx.grantPermissions(['notifications'], { origin: S.adres });
  // Tarayıcının bildirim servisine kaydı taklit edilir (başsız tarayıcıda gerçek servis yok)
  await ctx.addInitScript(([adres, p256dh, authB]) => {
    const coz = s => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0)).buffer;
    const sahte = { endpoint: 'https://bildirim.ornek.invalid/push/telefon-1', getKey: ad => coz(ad === 'p256dh' ? p256dh : authB), unsubscribe: async () => true };
    if (window.PushManager) {
      window.__aboneSecenek = null;
      PushManager.prototype.subscribe = async function (o) { window.__aboneSecenek = { goruluyor: o.userVisibleOnly, anahtarBoy: new Uint8Array(o.applicationServerKey).length }; localStorage.setItem('sahte.abone', '1'); return sahte; };
      PushManager.prototype.getSubscription = async function () { return localStorage.getItem('sahte.abone') ? sahte : null; };
    }
  }, [S.adres, alici.getPublicKey().toString('base64'), auth.toString('base64')]);
  const p = await ctx.newPage();
  const hatalar = []; p.on('pageerror', e => { hatalar.push(e.message); console.log('SAYFA HATASI', e.stack); });
  let deno = null;
  try {
    await p.goto(S.adres + '/');
    await p.waitForSelector('#authView');
    await p.click('#authView [data-mode="kayit"]'); await p.fill('#aMail', 'deniz@test.dev'); await p.fill('#aPass', 'gizli123'); await p.click('#aGo');
    await p.waitForSelector('#joinForm', { timeout: 15000 }); await p.fill('#jNick', 'Deniz'); await p.click('#joinForm button[type=submit]');
    const uid = S.hesaplar.get('deniz@test.dev').id;

    // ---- Servis çalışanı ----
    const sw = await p.evaluate(async () => { const r = await navigator.serviceWorker.ready; return { kapsam: r.scope, etkin: !!r.active }; });
    ok('Servis çalışanı kuruldu ve etkin', sw.etkin && sw.kapsam.startsWith(S.adres), JSON.stringify(sw));
    const manifest = await p.evaluate(async () => { const l = document.querySelector('link[rel=manifest]'); const m = await (await fetch(l.href)).json(); const ikon = await Promise.all(m.icons.map(async i => (await fetch(new URL(i.src, l.href))).ok)); return { ad: m.name, gorunum: m.display, ikon }; });
    ok('Uygulama bildirimi (manifest): ad, tam ekran, simgeler erişilebilir', manifest.ad === 'TusDostum' && manifest.gorunum === 'standalone' && manifest.ikon.every(Boolean), JSON.stringify(manifest));

    // ---- Zil → izin → cihaz kaydı ----
    await p.click('[data-hedef-ayarla]'); await p.waitForSelector('#alForm');
    await p.click('[data-chips="breakWarn"] button[data-v="5"]');
    await bekle(900);
    const abone = await S.sql('select endpoint, p256dh, auth from push_abonelikleri where uid = $1', [uid]);
    ok('Uyarı seçilince cihaz bildirim için kaydedildi', abone.length === 1 && abone[0].endpoint.endsWith('/push/telefon-1') && Buffer.from(abone[0].p256dh, 'base64url').length === 65 && Buffer.from(abone[0].auth, 'base64url').length === 16, JSON.stringify(abone));
    const sec = await p.evaluate(() => window.__aboneSecenek);
    ok('Kayıtta sunucunun açık anahtarı kullanıldı (65 bayt)', sec && sec.goruluyor === true && sec.anahtarBoy === 65, JSON.stringify(sec));
    ok('Bildirim açıkken pencerede "Bildirimler açık." yazıyor, düğme yok', (await p.textContent('#alNote')).trim() === 'Bildirimler açık.' && !(await p.$('#alPush')));
    await p.click('#alForm [data-close-modal]');

    // ---- Kronometre → mola → sunucuda uyarı ----
    await p.click('[data-act="start"]'); await bekle(500);
    await p.click('[data-act="pause"]'); await bekle(700);
    let u = await S.sql('select tur, dk from uyarilar where uid = $1', [uid]);
    ok('Molada sunucuda mola uyarısı bekliyor', u.length === 1 && u[0].tur === 'mola' && u[0].dk === 5, JSON.stringify(u));
    ok('Bildirim açıkken sessiz ses kaydı çalınmıyor (başka uygulamanın sesini kesmez)', await p.evaluate(() => !document.querySelector('audio') && !(navigator.mediaSession && navigator.mediaSession.metadata)));

    // ---- Vakti gelmemiş uyarı gönderilmez ----
    deno = spawn(process.env.DENO || 'deno', ['run', '--allow-net', '--allow-env', '--no-prompt', path.resolve(__dirname, '../supabase/functions/uyari-gonder/index.ts')], {
      env: { ...process.env, SUPABASE_URL: S.adres, SUPABASE_SERVICE_ROLE_KEY: 'servis', CRON_GIZLI: 'gizli', VAPID_ACIK: vapidAcik, VAPID_OZEL: vapidOzel, VAPID_KONU: 'mailto:test@ornek.dev', NO_COLOR: '1' } });
    let hazir = false;
    for (let i = 0; i < 150 && !hazir; i++) { await bekle(200); try { await fetch('http://127.0.0.1:8000/'); hazir = true; } catch {} }
    const cagir = async () => { const r = await fetch('http://127.0.0.1:8000/', { method: 'POST', headers: { 'x-cron-gizli': 'gizli' } }); return r.status === 200 ? r.json() : { hata: await r.text() }; };
    let s1 = await cagir();
    ok('Vakti gelmemiş uyarı gönderilmiyor', hazir && s1.gonderilen === 0 && S.pushlar.length === 0, JSON.stringify(s1));

    // ---- Saat ileri: uyarının vakti gelir (bildirim servisinin adresi yerel taklide çevrilir) ----
    await S.sql(`update uyarilar set zaman = now() - interval '2 seconds' where uid = $1`, [uid]);
    await S.sql(`update push_abonelikleri set endpoint = $2 where uid = $1`, [uid, S.adres + '/push/telefon-1']);
    s1 = await cagir();
    ok('Vakti gelince işlev bildirimi yolluyor', s1.gonderilen === 1 && S.pushlar.length === 1, JSON.stringify(s1));
    const tekrar = await S.sql(`select sira, kalan, round(extract(epoch from zaman - now()))::int as sn from uyarilar where uid = $1`, [uid]);
    ok('Gönderilen uyarı 5 dk sonrası için tekrar kuruldu (3 saat boyunca), hemen ikinci kez gitmiyor', tekrar.length === 1 && tekrar[0].sira === 1 && tekrar[0].kalan === 35 && tekrar[0].sn > 280 && tekrar[0].sn <= 301 && (await cagir()).gonderilen === 0, JSON.stringify(tekrar));
    let ileti = null;
    try { ileti = ece.decrypt(S.pushlar[0].govde, { version: 'aes128gcm', privateKey: alici, authSecret: auth }).toString('utf8'); } catch (e) { ileti = 'HATA ' + e.message; }
    ok('Telefon iletiyi kendi anahtarıyla çözebiliyor', /Mola bitti/.test(ileti), ileti);

    await S.sql(`update push_abonelikleri set endpoint = 'https://bildirim.ornek.invalid/push/telefon-1' where uid = $1`, [uid]);   // taklit adresi geri al

    // ---- Servis çalışanı iletiyi bildirime çeviriyor ----
    const cdp = await ctx.newCDPSession(p);
    let kayitNo = null;
    cdp.on('ServiceWorker.workerRegistrationUpdated', e => { for (const r of e.registrations) if (r.scopeURL.startsWith(S.adres)) kayitNo = r.registrationId; });
    await cdp.send('ServiceWorker.enable'); await bekle(500);
    let bildirimler = [];
    if (kayitNo) {
      await cdp.send('ServiceWorker.deliverPushMessage', { origin: S.adres, registrationId: kayitNo, data: ileti });
      for (let i = 0; i < 20 && !bildirimler.length; i++) { await bekle(200); bildirimler = await p.evaluate(async () => (await (await navigator.serviceWorker.ready).getNotifications()).map(n => ({ baslik: n.title, govde: n.body, etiket: n.tag }))); }
    }
    ok('Ekranda bildirim: yalnızca "⏰ Mola bitti!"', bildirimler.length === 1 && bildirimler[0].baslik === '⏰ Mola bitti!' && bildirimler[0].govde === '' && bildirimler[0].etiket === 'td-mola-0', JSON.stringify({ kayitNo, bildirimler }));

    // ---- Çalışmaya dönünce kalan tekrarlar iptal ----
    await p.click('[data-act="resume"]'); await bekle(900);
    const kalanTur = (await S.sql('select tur from uyarilar where uid = $1 order by tur', [uid])).map(r => r.tur);
    ok('Çalışmaya dönünce mola tekrarları iptal oluyor', !kalanTur.includes('mola'), JSON.stringify(kalanTur));

    // ---- Çevrimdışı: uygulama kabuğu önbellekten açılıyor ----
    await p.reload(); await bekle(1500);                             // servis çalışanı sayfayı devraldıktan sonraki yükleme önbelleği doldurur
    await ctx.setOffline(true);
    let acildi = false;
    try { await p.reload({ timeout: 8000 }); acildi = await p.evaluate(() => !!document.querySelector('#timerCard') && document.title === 'TusDostum'); } catch {}
    ok('İnternet yokken uygulama kabuğu açılıyor', acildi);
    await ctx.setOffline(false);

    // ---- Çıkışta cihaz kaydı silinir ----
    await p.reload(); await bekle(1800);
    await p.click('#settingsBtn'); await p.waitForSelector('#gOut'); await p.click('#gOut');
    await p.waitForSelector('#authView', { timeout: 10000 }); await bekle(300);
    ok('Çıkış yapınca bu cihazın bildirim kaydı silindi', (await S.sql('select 1 from push_abonelikleri where uid = $1', [uid])).length === 0);
    ok('Sayfa hatası yok', hatalar.length === 0, hatalar.join(' | '));
  } catch (e) {
    ok('Test akışı tamamlandı', false, (e && e.stack) || String(e));
  } finally { if (deno) deno.kill(); }
  console.log(out.join('\n'));
  console.log(`\n${out.filter(x => x.startsWith('GEÇTİ')).length} geçti, ${out.filter(x => x.startsWith('KALDI')).length} kaldı`);
  await b.close(); await S.kapat();
})();
