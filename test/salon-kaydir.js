// Salon ve sekmeler arası kaydırma: oda kutusunun içinde odalar, dışında (alttaki boşluk, kronometre şeridi, diğer
// sekmeler) alttaki sekmeler değişir. İçerik parmağı izler. Oda kutusu ekranın altına kadar uzanır, altında boşluk kalır.
// Odadakiler bugünkü süreye göre çoktan aza sıralanır.
// Çalıştırma: NODE_PATH=$(npm root -g) node test/salon-kaydir.js
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const F = 'file://' + path.resolve(__dirname, '../index.html');
const out = [];
const ok = (ad, kosul, ek = '') => out.push(`${kosul ? 'GEÇTİ ' : 'KALDI '} ${ad}${!kosul && ek ? ' — ' + ek : ''}`);
const MOCK = /const MOCK = `([\s\S]*?)`;\n/.exec(fs.readFileSync(path.join(__dirname, 'bulut.js'), 'utf8'))[1];
const pad = n => String(n).padStart(2, '0');
const bugun = (() => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; })();
const bekle = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const b = await chromium.launch();
  const now = Date.now();
  const gun = (m, st) => ({ d: bugun, e: [{ id: 'x' + m, d: bugun, s: 'anatomi', t: 'konu', m, mm: m, st, en: st + (m + 2) * 60000, b: 0, q: 0, c: 0, w: 0 }] });
  const bas = (() => { const d = new Date(); d.setHours(0, 30, 0, 0); return d.getTime(); })();
  const seed = {
    'logs/u_me': { nick: 'Ben', rooms: ['Kızlar', 'TSM'], room: 'Kızlar', migrated: 4, joinedAt: 1, timer: null },
    'data/users/u_me/kronometre': { timer: { s: 'anatomi', t: 'konu', st: now - 600e3, runStart: null, workMs: 0, breakStart: now - 60e3, breakMs: 0, bn: 1 }, rev: now },
    'logs/u_a': { nick: 'Ayşe', rooms: ['Kızlar'], room: 'Kızlar', migrated: 4, timer: null, day: gun(30, bas) },
    'logs/u_b': { nick: 'Burak', rooms: ['Kızlar'], room: 'Kızlar', migrated: 4, timer: null, day: gun(90, bas) },
    'logs/u_c': { nick: 'Cem', rooms: ['Kızlar'], room: 'Kızlar', migrated: 4, timer: { s: 'pediatri', t: 'konu', st: now - 3600e3, runStart: now - 50 * 60000, workMs: 0, breakStart: null, breakMs: 0, bn: 0 } },
    'logs/u_d': { nick: 'Deniz', rooms: ['TSM'], room: 'TSM', migrated: 4, timer: null, day: gun(15, bas) },
  };
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true });
  const p = await ctx.newPage();
  const hatalar = []; p.on('pageerror', e => hatalar.push(e.message));
  await p.addInitScript(`window.__mockseed = ${JSON.stringify(seed)}; window.__mockcfg = {};`);
  await p.addInitScript(MOCK);
  await p.addInitScript(() => { localStorage.setItem('tusdostum.pref', JSON.stringify({ welcomed: true, activeRoom: 'genel' })); });
  await p.goto(F + '#salon'); await bekle(1500);
  const durum = () => p.evaluate(() => ({ sekme: location.hash, oda: (document.querySelector('#onlinePanel h2') || {}).textContent, kisiler: [...document.querySelectorAll('#onlinePanel .person .nm')].map(x => x.textContent.replace('sen', '').trim()) }));
  // Parmak hareketi: (x0,y0) noktasındaki öğeden başlar, adım adım ilerler
  const dokun = (x0, y0) => p.evaluate(([x0, y0]) => {
    const el = document.elementFromPoint(x0, y0); window.__dk = { el, x0, y0 };
    const t = (x, y) => new Touch({ identifier: 1, target: el, clientX: x, clientY: y });
    el.dispatchEvent(new TouchEvent('touchstart', { touches: [t(x0, y0)], changedTouches: [t(x0, y0)], bubbles: true, cancelable: true }));
  }, [x0, y0]);
  const surukle = (dx, dy) => p.evaluate(([dx, dy]) => {
    const { el, x0, y0 } = window.__dk;
    const t = (x, y) => new Touch({ identifier: 1, target: el, clientX: x, clientY: y });
    for (let i = 1; i <= 6; i++) el.dispatchEvent(new TouchEvent('touchmove', { touches: [t(x0 + dx * i / 6, y0 + dy * i / 6)], changedTouches: [t(x0 + dx * i / 6, y0 + dy * i / 6)], bubbles: true, cancelable: true }));
  }, [dx, dy]);
  const birak = (dx, dy) => p.evaluate(([dx, dy]) => {
    const { el, x0, y0 } = window.__dk;
    const t = (x, y) => new Touch({ identifier: 1, target: el, clientX: x, clientY: y });
    el.dispatchEvent(new TouchEvent('touchend', { touches: [], changedTouches: [t(x0 + dx, y0 + dy)], bubbles: true, cancelable: true }));
  }, [dx, dy]);
  const kaydir = async (x0, y0, dx, dy = 0) => { await dokun(x0, y0); await surukle(dx, dy); await bekle(40); await birak(dx, dy); await bekle(750); };
  const kisiY = () => p.evaluate(() => { const r = document.querySelector('#onlinePanel .person').getBoundingClientRect(); return r.top + r.height / 2; });
  const kutu = () => p.evaluate(() => {
    const r = document.querySelector('#onlinePanel').getBoundingClientRect(), s = document.querySelector('#timerStrip').getBoundingClientRect(), n = document.querySelector('nav.tabs').getBoundingClientRect();
    return { alt: Math.round(r.bottom), serit: Math.round(s.top), nav: Math.round(n.top), ekran: innerHeight };
  });

  ok('Ayrı "Canlı sıralama" paneli yok', !(await p.$('#rankPanel')) && !/Canlı sıralama/.test(await p.textContent('#panel-salon')));
  let k = await kutu();
  ok('Oda kutusu ekranın altına kadar uzanıyor; kronometre şeridinin üstünde sabit boşluk (~58 px) kalıyor', k.serit - k.alt >= 50 && k.serit - k.alt <= 70, JSON.stringify(k));
  let d = await durum();
  ok('Genel\'de herkes bugünkü süreye göre çoktan aza: Burak 90, Cem 50 (canlı), Ayşe 30, Deniz 15, Ben 0', JSON.stringify(d.kisiler) === JSON.stringify(['Burak', 'Cem', 'Ayşe', 'Deniz', 'Ben']), JSON.stringify(d.kisiler));

  // Parmağı izleme
  await dokun(200, await kisiY()); await surukle(-90, 0); await bekle(50);
  const iz = await p.evaluate(() => ({ icerik: document.querySelector('#onlinePanel .rbody').style.transform, sekmeler: document.querySelector('#onlinePanel .rtabs-wrap').style.transform, sayfa: document.querySelector('#panel-salon').style.transform }));
  const kayma = Number((/translate3d\((-?[\d.]+)px/.exec(iz.icerik) || [])[1]);
  ok('Sürüklerken oda içeriği parmakla birlikte kayıyor, kutu ve sekmeler yerinde', kayma <= -70 && kayma >= -92 && !iz.sekmeler && !iz.sayfa, JSON.stringify(iz));
  await birak(-90, 0); await bekle(750);
  d = await durum();
  ok('Bırakınca sonraki odaya geçti: Kızlar (çoktan aza, Deniz yok)', d.oda === 'Kızlar odası' && JSON.stringify(d.kisiler) === JSON.stringify(['Burak', 'Cem', 'Ayşe', 'Ben']), JSON.stringify(d));
  ok('Geçiş bitince içerik yerine oturdu', await p.evaluate(() => !document.querySelector('#onlinePanel .rbody').style.transform));
  await kaydir(200, await kisiY(), -120); d = await durum();
  ok('Bir daha sola: TSM', d.oda === 'TSM odası' && JSON.stringify(d.kisiler) === JSON.stringify(['Deniz', 'Ben']), JSON.stringify(d));
  await kaydir(200, await kisiY(), -150); d = await durum();
  ok('Son odada sola kaydırınca esneyip yerinde kalıyor', d.oda === 'TSM odası' && d.sekme === '#salon', JSON.stringify(d));
  await kaydir(200, await kisiY(), 120); d = await durum();
  ok('Sağa kaydırınca önceki oda: Kızlar', d.oda === 'Kızlar odası', JSON.stringify(d));
  await kaydir(200, await kisiY(), 40); d = await durum();
  ok('Kısa hareket bırakınca geri yerine dönüyor', d.oda === 'Kızlar odası' && await p.evaluate(() => !document.querySelector('#onlinePanel .rbody').style.transform), JSON.stringify(d));
  await kaydir(200, await kisiY(), 60, 200); d = await durum();
  ok('Aşağı/yukarı hareket (sayfayı gezinme) oda değiştirmiyor', d.oda === 'Kızlar odası', JSON.stringify(d));
  await kaydir(8, await kisiY(), 150); d = await durum();
  ok('Ekran kenarından başlayan hareket bir şey değiştirmiyor', d.oda === 'Kızlar odası' && d.sekme === '#salon', JSON.stringify(d));

  // Kutunun altındaki boşluk ve kronometre şeridi: sekmeler
  k = await kutu();
  await kaydir(200, k.alt + 25, -130); d = await durum();
  ok('Kutunun altındaki boşlukta sola kaydırınca sonraki sekme: Dersler', d.sekme === '#dersler', JSON.stringify(d));
  const tileY = await p.evaluate(() => { const r = document.querySelector('#panel-dersler .tiles').getBoundingClientRect(); return r.top + r.height / 2; });
  await kaydir(200, tileY, 130); d = await durum();
  ok('Dersler\'de sağa kaydırınca önceki sekme: Salon', d.sekme === '#salon', JSON.stringify(d));
  await p.evaluate(() => { location.hash = 'dersler'; }); await bekle(300);
  const selY = await p.evaluate(() => { const r = document.querySelector('#periodMonth').getBoundingClientRect(); return r.top + r.height / 2; });
  await kaydir(120, selY, 130); d = await durum();
  ok('Seçim kutusunun üstünde kaydırma sekme değiştirmiyor', d.sekme === '#dersler', JSON.stringify(d));
  await p.evaluate(() => { location.hash = 'salon'; }); await bekle(400);
  k = await kutu();
  await kaydir(150, k.serit + 20, 130); d = await durum();
  ok('Kronometre şeridinde sağa kaydırınca önceki sekme: Bugün (kronometre)', d.sekme === '#bugun', JSON.stringify(d));
  await kaydir(200, 400, -130); d = await durum();
  ok('Bugün\'de (kronometre) sola kaydırınca Salon\'a (odalara) geçiyor', d.sekme === '#salon', JSON.stringify(d));
  await p.evaluate(() => { location.hash = 'bugun'; }); await bekle(300);
  await kaydir(200, 400, 150); d = await durum();
  ok('İlk sekmede sağa kaydırınca esneyip yerinde kalıyor', d.sekme === '#bugun', JSON.stringify(d));
  ok('Geçişlerden sonra hiçbir sayfa kaymış kalmadı', await p.evaluate(() => [...document.querySelectorAll('[data-tab-panel]')].every(x => !x.style.transform)));
  await p.evaluate(() => { location.hash = 'salon'; }); await bekle(5600); d = await durum();
  ok('5 sn sonraki yenilemede seçili oda ve sıra korunuyor', d.oda === 'Kızlar odası' && d.kisiler[0] === 'Burak', JSON.stringify(d));
  ok('Sayfa hatası yok', !hatalar.length, hatalar.join(' | '));
  console.log(out.join('\n'));
  await b.close();
})();
