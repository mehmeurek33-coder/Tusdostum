// Hedef kutusu ("Hedef ve molalar"): günlük hedef 3–12 sa ya da kapalı, mola düzeni, kalıcılık, görünüm.
// Çalıştırma: NODE_PATH=$(npm root -g) node test/hedef.js
const { chromium } = require('playwright');
const path = require('path');
const F = 'file://' + path.resolve(__dirname, '../index.html');
const out = [];
const ok = (ad, kosul, ek = '') => out.push(`${kosul ? 'GEÇTİ ' : 'KALDI '} ${ad}${!kosul && ek ? ' — ' + ek : ''}`);
const bekle = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 } });
  await ctx.addInitScript(() => { try { Object.defineProperty(window, 'TUSDOSTUM_AYAR', { get: () => ({}), set: () => {}, configurable: false }); } catch {} });
  const p = await ctx.newPage();
  const hatalar = []; p.on('pageerror', e => hatalar.push(e.message));
  await p.goto(F);
  // bugün 2 sa 15 dk (kronometreli) çalışılmış
  const kur = (ayar, dk = 135) => p.evaluate(([ayar, dk]) => {
    const n = Date.now(), d = new Date(), g = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    const kron = { [g.slice(0, 7)]: { a: { d: g, s: 'dahiliye', t: 'konu', m: dk, mm: dk, st: n - (dk + 30) * 60000, en: n - 30 * 60000, b: 0, bn: 0, q: 0, c: 0, w: 0, ts: n - 1800e3 } } };
    localStorage.clear();
    localStorage.setItem('tusdostum.v3', JSON.stringify({ root: { nick: 'H' }, kron, manual: {}, settings: { firstDay: g, ...ayar }, denemeler: {} }));
    localStorage.setItem('tusdostum.pref', JSON.stringify({ welcomed: true }));
  }, [ayar, dk]);
  const kutu = () => p.evaluate(() => { const k = document.querySelector('.hk'); return k ? { metin: k.textContent.replace(/\s+/g, ' ').trim(), h: Math.round(k.getBoundingClientRect().height), dolu: (k.querySelector('.dolgu') || {}).style ? k.querySelector('.dolgu').style.width : null, tamam: k.classList.contains('tamam') } : null; });
  const ayarlar = () => p.evaluate(() => JSON.parse(localStorage.getItem('tusdostum.v3')).settings);
  const pencere = async () => { await p.click('[data-hedef-ayarla]'); await p.waitForSelector('#alForm'); };
  const sec = async (grup, v) => { await p.click(`[data-chips="${grup}"] button[data-v="${v}"]`); await bekle(250); };
  const kapat = async () => { await p.click('#alForm [data-close-modal]'); await bekle(250); };

  // 1) Varsayılan: hedef 4 sa, zil yok
  await kur({}); await p.reload(); await bekle(900);
  let k = await kutu();
  ok('Kronometrede zil yok', !(await p.$('#timerCard .bell')));
  ok('Hedef kutusu kronometrenin altında, "Bugün" kartının üstünde', await p.evaluate(() => { const k = document.querySelector('.hk'), t = document.querySelector('#timerCard'), bg = [...document.querySelectorAll('#todaySide .panel')].find(x => /Bugün/.test(x.querySelector('h2') ? x.querySelector('h2').textContent : '')); return k.getBoundingClientRect().top > t.getBoundingClientRect().bottom && k.getBoundingClientRect().bottom < bg.getBoundingClientRect().top; }));
  ok('Varsayılan hedef 4 saat: "1:45 kaldı", kutu %56 dolu, yüzde yazmıyor', k && /1:45\s*kaldı/.test(k.metin) && /Hedef 4 saat/.test(k.metin) && k.dolu === '56%' && !/%/.test(k.metin), JSON.stringify(k));
  // 2) Pencere: seçenekler
  await pencere();
  const sec1 = await p.evaluate(() => Object.fromEntries([...document.querySelectorAll('#alForm [data-chips]')].map(c => [c.dataset.chips, [...c.querySelectorAll('button')].map(x => x.textContent.trim())])));
  ok('Pencere: hedef Kapalı, 3–12 sa', JSON.stringify(sec1.goal) === JSON.stringify(['Kapalı', '3 sa', '4 sa', '5 sa', '6 sa', '7 sa', '8 sa', '9 sa', '10 sa', '11 sa', '12 sa']), JSON.stringify(sec1.goal));
  ok('Pencere: kaç dakikada bir mola — Kapalı, 30, 45, 60, 75, 90, 120 dk', JSON.stringify(sec1.workWarn) === JSON.stringify(['Kapalı', '30 dk', '45 dk', '60 dk', '75 dk', '90 dk', '120 dk']), JSON.stringify(sec1.workWarn));
  ok('Pencere: mola kaç dakika — Kapalı, 5, 10, 15, 20, 25, 30 dk', JSON.stringify(sec1.breakWarn) === JSON.stringify(['Kapalı', '5 dk', '10 dk', '15 dk', '20 dk', '25 dk', '30 dk']), JSON.stringify(sec1.breakWarn));
  ok('Pencere başlığı "Hedef ve molalar"', (await p.textContent('#alForm')).includes('Hedef ve molalar'));
  // 3) 7 sa, 45 dk'da 15 dk mola
  await sec('goal', 420); await sec('workWarn', 45); await sec('breakWarn', 15); await kapat();
  k = await kutu();
  ok('7 sa seçilince: "4:45 kaldı", "Hedef 7 saat", "45 dk\'da 15 dk mola"', /4:45\s*kaldı/.test(k.metin) && /Hedef 7 saat/.test(k.metin) && /45 dk'da 15 dk mola/.test(k.metin) && k.dolu === '32%', JSON.stringify(k));
  let a = await ayarlar();
  ok('Seçimler kaydedildi (goalMin 420, workWarn 45, breakWarn 15)', a.goalMin === 420 && a.workWarn === 45 && a.breakWarn === 15 && !a.hedefKapali, JSON.stringify(a));
  ok('"Bugün" kartında "Hedef 7 sa"', (await p.textContent('#todaySide')).includes('Hedef 7 sa'));
  const acikH = k.h;
  // 4) Kalıcılık: yeniden açınca aynı
  await p.reload(); await bekle(900);
  k = await kutu();
  ok('Uygulama yeniden açılınca seçimler korunuyor', /Hedef 7 saat/.test(k.metin) && /45 dk'da 15 dk mola/.test(k.metin), JSON.stringify(k));
  // 5) Kapalı
  await pencere(); await sec('goal', 0); await kapat();
  k = await kutu();
  ok('Hedef kapalı: "Günlük hedef kapalı", mola düzeni duruyor, dolgu yok', /Günlük hedef kapalı/.test(k.metin) && /45 dk'da 15 dk mola/.test(k.metin) && k.dolu === null, JSON.stringify(k));
  ok('Hedef kapalıyken "Bugün" kartında hedef yazısı ve çubuğu yok', await p.evaluate(() => { const kp = document.querySelector('#todaySide .kpi'); return !/Hedef/.test(kp.textContent) && !kp.querySelector('.bar'); }));
  ok('Kutu iki durumda da aynı kalınlıkta', Math.abs(k.h - acikH) <= 2, `${acikH} / ${k.h}`);
  await p.reload(); await bekle(900);
  ok('Kapalı seçimi yeniden açılışta korunuyor', /Günlük hedef kapalı/.test((await kutu()).metin));
  await pencere();
  ok('Pencerede "Kapalı" seçili görünüyor', await p.$eval('[data-chips="goal"] button[data-v="0"]', e => e.getAttribute('aria-checked') === 'true'));
  await sec('goal', 420); await kapat();
  ok('Yeniden açınca hedef 7 saat', /Hedef 7 saat/.test((await kutu()).metin));
  // 6) Hedef tamam
  await kur({ goalMin: 180 }, 200); await p.reload(); await bekle(900);
  k = await kutu();
  ok('Hedef dolunca: ✓, "Hedef 3 saat tamam", "+20 dk fazladan", kutu tam dolu', k.tamam && /✓/.test(k.metin) && /Hedef 3 saat tamam/.test(k.metin) && /\+20 dk fazladan/.test(k.metin) && k.dolu === '100%', JSON.stringify(k));
  // 7) Ayarlar'dan süre hedefi ve mola uyarısı kalktı
  await p.click('#settingsBtn'); await p.waitForSelector('#setForm');
  const ay = (await p.textContent('#setForm')).replace(/\s+/g, ' ');
  ok('Ayarlar\'da "Günlük süre hedefi" ve "Mola uyarısı" yok; soru hedefi duruyor', !/süre hedefi/i.test(ay) && !/Mola uyarısı/.test(ay) && /soru hedefi/i.test(ay) && !(await p.$('#gM')) && !(await p.$('#gBW')), ay.slice(0, 200));
  await p.click('#setForm button[type=submit]'); await bekle(300);
  ok('Ayarları kaydetmek hedefi değiştirmiyor', (await ayarlar()).goalMin === 180);
  // 8) Telefon genişliğinde taşma yok
  await p.setViewportSize({ width: 320, height: 700 }); await bekle(300);
  ok('320 px genişlikte kutu taşmıyor', await p.evaluate(() => { const k = document.querySelector('.hk'); return k.scrollWidth <= k.clientWidth + 1 && document.documentElement.scrollWidth <= 320; }));
  ok('Sayfa hatası yok', !hatalar.length, hatalar.join(' | '));
  console.log(out.join('\n'));
  console.log(`\n${out.filter(x => x.startsWith('GEÇTİ')).length} geçti, ${out.filter(x => x.startsWith('KALDI')).length} kaldı`);
  await b.close();
})();
