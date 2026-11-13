// Kilit ekranında sayaç (deneysel): "Şimdi Çalınan" bilgisi doğru ders ve süreyi gösteriyor mu, kapalıyken hiçbir şey
// çalıyor mu, kilit ekranından duraklatma kronometreyi etkiliyor mu. (Gerçek iPhone kilit ekranı burada sınanamaz.)
// Çalıştırma: NODE_PATH=$(npm root -g) node test/kilit-ekrani.js
const { chromium } = require('playwright');
const path = require('path');
const F = 'file://' + path.resolve(__dirname, '../index.html');
const out = [];
const ok = (ad, kosul, ek = '') => out.push(`${kosul ? 'GEÇTİ ' : 'KALDI '} ${ad}${!kosul && ek ? ' — ' + ek : ''}`);
const bekle = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const b = await chromium.launch({ args: ['--autoplay-policy=user-gesture-required'] });
  const ctx = await b.newContext({ viewport: { width: 390, height: 800 } });
  await ctx.addInitScript(() => {
    try { Object.defineProperty(window, 'TUSDOSTUM_AYAR', { get: () => ({}), set: () => {}, configurable: false }); } catch {}
    // mediaSession çağrılarını kaydet
    window.__ms = { pos: null, handlers: {}, oynayan: 0 };
    const ms = navigator.mediaSession;
    const sp = ms.setPositionState && ms.setPositionState.bind(ms);
    ms.setPositionState = st => { window.__ms.pos = st; if (sp) try { sp(st); } catch {} };
    const sa = ms.setActionHandler.bind(ms);
    ms.setActionHandler = (a, h) => { window.__ms.handlers[a] = h; try { sa(a, h); } catch {} };
    const play = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function () { window.__ms.oynayan++; window.__ms.el = this; return play.call(this); };
  });
  const p = await ctx.newPage();
  const hatalar = []; p.on('pageerror', e => hatalar.push(e.message));
  await p.goto(F);
  await p.evaluate(() => { localStorage.clear(); localStorage.setItem('tusdostum.v3', JSON.stringify({ root: { nick: 'K' }, kron: {}, manual: {}, settings: {}, denemeler: {} })); localStorage.setItem('tusdostum.pref', JSON.stringify({ welcomed: true })); });
  await p.reload(); await bekle(600);
  const durum = () => p.evaluate(() => ({ baslik: navigator.mediaSession.metadata && navigator.mediaSession.metadata.title, sanatci: navigator.mediaSession.metadata && navigator.mediaSession.metadata.artist, pos: window.__ms.pos, oynayan: window.__ms.oynayan, caliyor: !!(window.__ms.el && !window.__ms.el.paused), dongu: !!(window.__ms.el && window.__ms.el.loop), saat: document.querySelector('#clock').textContent }));
  const sn = t => { const [h, m, s] = t.split(':').map(Number); return h * 3600 + m * 60 + s; };

  // Kapalıyken
  await p.click('[data-act="start"]'); await bekle(1200);
  let d = await durum();
  ok('Ayar kapalıyken kronometre başlayınca hiçbir ses çalmıyor, kilit ekranına bilgi gitmiyor', d.oynayan === 0 && !d.baslik, JSON.stringify(d));
  // Ayarlardan aç
  await p.click('#settingsBtn'); await p.waitForSelector('#gLock');
  const metin = await p.evaluate(() => document.querySelector('#gLock').closest('label').textContent.replace(/\s+/g, ' ').trim());
  ok('Ayarlarda "Kilit ekranında sayaç" seçeneği ve uyarısı var', /Kilit ekranında sayaç/.test(metin) && /müzik durur/.test(metin), metin);
  await p.check('#gLock'); await p.click('#setForm button[type=submit]'); await bekle(1500);
  d = await durum();
  ok('Açılınca sessiz kayıt döngüde çalıyor', d.caliyor && d.dongu, JSON.stringify(d));
  ok('Kilit ekranı bilgisi: "Anatomi · Konu" — TusDostum', d.baslik === 'Anatomi · Konu' && d.sanatci === 'TusDostum', JSON.stringify(d));
  ok('Kilit ekranındaki süre kronometreyle aynı', d.pos && Math.abs(d.pos.position - sn(d.saat)) <= 1 && d.pos.playbackRate === 1 && d.pos.duration > d.pos.position, JSON.stringify(d));
  // Kilit ekranından "duraklat" → kronometre durmamalı
  await p.evaluate(() => window.__ms.handlers.pause && window.__ms.handlers.pause());
  await bekle(300);
  ok('Kilit ekranından duraklatma kronometreyi durdurmuyor', await p.evaluate(() => /Çalışıyor/.test(document.querySelector('#timerCard').textContent)));
  // Mola
  await bekle(2200);
  await p.click('[data-act="pause"]'); await bekle(1500);
  d = await durum();
  ok('Molada kilit ekranı: "Mola · Anatomi", süre molanın süresi', d.baslik === 'Mola · Anatomi' && Math.abs(d.pos.position - sn(d.saat)) <= 1, JSON.stringify(d));
  ok('Mola uyarısı için ayrı ses kaydı başlatılmadı (tek ses)', d.oynayan <= 2, JSON.stringify(d));
  await p.click('[data-act="resume"]'); await bekle(600);
  d = await durum();
  ok('Çalışmaya dönünce kilit ekranı yeniden "Anatomi · Konu"', d.baslik === 'Anatomi · Konu', JSON.stringify(d));
  // Uygulama yeniden açılınca ilk dokunuşta geri gelir
  await p.reload(); await bekle(800);
  d = await durum();
  ok('Yeniden açılışta dokunmadan ses başlamıyor', d.oynayan === 0, JSON.stringify(d));
  await p.click('#timerCard h2'); await bekle(800);
  d = await durum();
  ok('İlk dokunuşta kilit ekranı sayacı geri geliyor', d.caliyor && d.baslik === 'Anatomi · Konu', JSON.stringify(d));
  // Sıfırla → durur
  await p.click('[data-act="reset"]'); await p.click('[data-act="reset-yes"]'); await bekle(600);
  d = await durum();
  ok('Kronometre bitince ses durur ve kilit ekranı bilgisi kalkar', !d.caliyor && !d.baslik, JSON.stringify(d));
  // Kapatınca
  await p.click('[data-act="start"]'); await bekle(600);
  await p.click('#settingsBtn'); await p.waitForSelector('#gLock'); await p.uncheck('#gLock'); await p.click('#setForm button[type=submit]'); await bekle(800);
  d = await durum();
  ok('Ayar kapatılınca ses hemen durur', !d.caliyor && !d.baslik, JSON.stringify(d));
  ok('Sayfa hatası yok', !hatalar.length, hatalar.join(' | '));
  console.log(out.join('\n'));
  await b.close();
})();
