// Gün 02:00'de yenilenir; süren mola 3 saatte durur. Saat taklit edilerek denenir.
// Çalıştırma: NODE_PATH=$(npm root -g) node test/gun-siniri.js
const { chromium } = require('playwright');
const path = require('path');
const F = 'file://' + path.resolve(__dirname, '../index.html');
const out = [];
const ok = (ad, kosul, ek = '') => out.push(`${kosul ? 'GEÇTİ ' : 'KALDI '} ${ad}${!kosul && ek ? ' — ' + ek : ''}`);

(async () => {
  const b = await chromium.launch(); const hatalar = [];
  const ac = async (saat, timer, kron = {}) => {
    const ctx = await b.newContext({ viewport: { width: 390, height: 844 } });
    await ctx.addInitScript(() => { try { Object.defineProperty(window, 'TUSDOSTUM_AYAR', { get: () => ({}), set: () => {}, configurable: false }); } catch {} });
    const p = await ctx.newPage(); p.on('pageerror', e => hatalar.push(e.message));
    await p.clock.install({ time: new Date(saat) });
    await p.goto(F);
    await p.evaluate(([timer, kron]) => { localStorage.clear(); localStorage.setItem('tusdostum.v3', JSON.stringify({ root: { nick: 'G', timer: timer ? timer(Date.now()) : null }, kron, manual: {}, settings: { goalMin: 240, firstDay: '2026-11-01' }, denemeler: {} })); localStorage.setItem('tusdostum.pref', JSON.stringify({ welcomed: true })); }, [null, kron]);
    if (timer) await p.evaluate(src => { const v = JSON.parse(localStorage.getItem('tusdostum.v3')); v.root.timer = (new Function('return ' + src))()(Date.now()); localStorage.setItem('tusdostum.v3', JSON.stringify(v)); }, timer.toString());
    await p.reload(); await p.clock.runFor(1500);
    return p;
  };
  const bugunToplam = p => p.evaluate(() => document.querySelector('#todaySide .kpi .v').textContent.trim());

  // 1) 19 Kasım 01:30: gün hâlâ 18 Kasım. 01:00'de başlayan 30 dk'lık oturum 18 Kasım'a yazılır
  let p = await ac('2026-11-19T01:30:00', n => ({ s: 'anatomi', t: 'konu', st: n - 30 * 60000, runStart: n - 30 * 60000, workMs: 0, breakStart: null, breakMs: 0, bn: 0 }),
    { '2026-11': { a: { d: '2026-11-18', s: 'patoloji', t: 'konu', m: 120, mm: 120, st: new Date('2026-11-18T20:00:00').getTime(), en: new Date('2026-11-18T22:00:00').getTime(), b: 0, bn: 0, q: 0, c: 0, w: 0 } } });
  ok('Gece 01:30\'da "bugün" hâlâ önceki gün (18 Kasım): akşamki 2 sa + süren 30 dk = 2 sa 30 dk', await bugunToplam(p) === '2 sa 30 dk', await bugunToplam(p));
  await p.click('[data-act="finish"]'); await p.waitForSelector('#entryForm'); await p.click('#entryForm button[type=submit]'); await p.clock.runFor(800);
  const kayit = await p.evaluate(() => Object.values(JSON.parse(localStorage.getItem('tusdostum.v3')).kron['2026-11']).filter(e => e.s === 'anatomi'));
  ok('01:00–01:30 oturumu 18 Kasım\'a kaydedildi', kayit.length === 1 && kayit[0].d === '2026-11-18', JSON.stringify(kayit));
  // 02:00'yi geçince yeni gün
  await p.clock.runFor(31 * 60000); await p.clock.runFor(61000);
  ok('02:00\'den sonra yeni gün başladı: "bugün" 0 dk', await bugunToplam(p) === '0 dk', await bugunToplam(p));
  await p.context().close();

  // 2) 01:00'de başlayıp 02:30'da biten oturum: 18 Kasım (01:00–02:00) ve 19 Kasım (02:00–02:30) olarak bölünür
  p = await ac('2026-11-19T02:30:00', n => ({ s: 'dahiliye', t: 'konu', st: n - 90 * 60000, runStart: n - 90 * 60000, workMs: 0, breakStart: null, breakMs: 0, bn: 0 }));
  ok('02:30\'da süren oturumun yalnızca 02:00 sonrası (30 dk) bugüne sayılıyor', await bugunToplam(p) === '30 dk', await bugunToplam(p));
  await p.click('[data-act="finish"]'); await p.waitForSelector('#entryForm'); await p.click('#entryForm button[type=submit]'); await p.clock.runFor(800);
  const parca = await p.evaluate(() => Object.values(JSON.parse(localStorage.getItem('tusdostum.v3')).kron['2026-11']).map(e => [e.d, e.m]).sort());
  ok('Gün sınırını (02:00) aşan oturum iki güne bölündü: 18 Kasım 60 dk, 19 Kasım 30 dk', JSON.stringify(parca) === JSON.stringify([['2026-11-18', 60], ['2026-11-19', 30]]), JSON.stringify(parca));
  await p.context().close();

  // 3) Gün 00:00'da değil: 23:59 → 00:30 aynı gün
  p = await ac('2026-11-19T00:30:00', n => ({ s: 'anatomi', t: 'konu', st: n - 60 * 60000, runStart: n - 60 * 60000, workMs: 0, breakStart: null, breakMs: 0, bn: 0 }));
  ok('23:30–00:30 oturumunun tamamı aynı güne sayılıyor (gece yarısında bölünmüyor)', await bugunToplam(p) === '1 sa', await bugunToplam(p));
  await p.context().close();

  // 4) Mola 3 saatte durur
  p = await ac('2026-11-19T15:00:00', n => ({ s: 'anatomi', t: 'konu', st: n - 5 * 3600e3, runStart: null, workMs: 60 * 60000, breakStart: n - (4 * 60 + 10) * 60000, breakMs: 0, bn: 1 }));
  const saat1 = await p.textContent('#clock');
  await p.clock.runFor(120000);
  const saat2 = await p.textContent('#clock');
  ok('4 sa 10 dk süren molada sayaç 03:00:00\'da duruyor', saat1 === '03:00:00' && saat2 === '03:00:00', `${saat1} → ${saat2}`);
  await p.click('[data-act="finish"]'); await p.waitForSelector('#entryForm'); await p.click('#entryForm button[type=submit]'); await p.clock.runFor(800);
  const mola = await p.evaluate(() => Object.values(JSON.parse(localStorage.getItem('tusdostum.v3')).kron['2026-11'] || {}).map(e => [e.m, e.b]));
  ok('Kaydedilen oturumda mola en çok 3 saat (180 dk), çalışma 60 dk', JSON.stringify(mola) === JSON.stringify([[60, 180]]), JSON.stringify(mola));
  await p.context().close();
  p = await ac('2026-11-19T15:00:00', n => ({ s: 'anatomi', t: 'konu', st: n - 90 * 60000, runStart: null, workMs: 30 * 60000, breakStart: n - 50 * 60000, breakMs: 0, bn: 1 }));
  ok('3 saatten kısa molada sayaç normal ilerliyor (00:50:xx)', /^00:50:0\d$/.test(await p.textContent('#clock')), await p.textContent('#clock'));
  await p.context().close();

  ok('Sayfa hatası yok', !hatalar.length, hatalar.join(' | '));
  console.log(out.join('\n'));
  console.log(`\n${out.filter(x => x.startsWith('GEÇTİ')).length} geçti, ${out.filter(x => x.startsWith('KALDI')).length} kaldı`);
  await b.close();
})();
