// "Başladığından beri" takvimi elle girilen kayıtları da sayar.
// Çalıştırma: NODE_PATH=$(npm root -g) node test/takvim-elle.js
const { chromium } = require('playwright');
const path = require('path');
const F = 'file://' + path.resolve(__dirname, '../index.html');
const out = [];
const ok = (ad, kosul, ek = '') => out.push(`${kosul ? 'GEÇTİ ' : 'KALDI '} ${ad}${!kosul && ek ? ' — ' + ek : ''}`);
const pad = n => String(n).padStart(2, '0');
const dk = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 390, height: 800 } });
  await ctx.addInitScript(() => { try { Object.defineProperty(window, 'TUSDOSTUM_AYAR', { get: () => ({}), set: () => {}, configurable: false }); } catch {} });
  const p = await ctx.newPage();
  const hatalar = []; p.on('pageerror', e => hatalar.push(e.message));
  await p.goto(F);
  const g = n => { const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - n); return d; };
  const dun = dk(g(1)), once = dk(g(2)), st = g(1).getTime() + 9 * 3600e3;
  const ym = d => d.slice(0, 7);
  const kron = {}; (kron[ym(dun)] = kron[ym(dun)] || {}).t1 = { d: dun, s: 'anatomi', t: 'konu', m: 60, mm: 60, st, en: st + 65 * 60000, b: 5, bn: 1, q: 0, c: 0, w: 0, n: '', k: '', ts: st };
  const manual = {};
  (manual[ym(dun)] = manual[ym(dun)] || {}).m1 = { d: dun, s: 'patoloji', t: 'tekrar', m: 30, q: 0, c: 0, w: 0, n: '', k: '', ts: 1 };
  (manual[ym(once)] = manual[ym(once)] || {}).m2 = { d: once, s: 'dahiliye', t: 'soru', m: 45, q: 20, c: 15, w: 5, n: '', k: '', ts: 2 };
  await p.evaluate(([k, v]) => { localStorage.clear(); localStorage.setItem(k, JSON.stringify(v)); localStorage.setItem('tusdostum.pref', JSON.stringify({ welcomed: true })); },
    ['tusdostum.v3', { root: { nick: 'T' }, kron, manual, settings: { firstDay: dk(g(5)) }, denemeler: {} }]);
  await p.reload(); await p.waitForTimeout(800);
  const v = await p.evaluate(([a, c]) => ({ dun: document.querySelector(`#heatPanel i[data-k="${a}"]`)?.dataset.v, once: document.querySelector(`#heatPanel i[data-k="${c}"]`)?.dataset.v, sub: document.querySelector('#heatPanel .panel-head .small').textContent }), [dun, once]);
  ok('Dün: kronometreli 60 + elle 30 = 90 dk sayılıyor', v.dun === '90', JSON.stringify(v));
  ok('Yalnızca elle kayıt olan gün de dolu görünüyor (45 dk)', v.once === '45', JSON.stringify(v));
  ok('Aktif gün sayısına elle kayıtlı gün de giriyor (2 aktif gün)', /2 aktif gün/.test(v.sub), v.sub);
  await p.click(`#heatPanel i[data-k="${dun}"]`); await p.waitForTimeout(200);
  const r1 = (await p.textContent('#heatRead')).replace(/\s+/g, ' ');
  ok('Güne dokununca toplam ve elle kısmı yazıyor: "1 sa 30 dk (elle 30 dk)"', /1 sa 30 dk \(elle 30 dk\)/.test(r1), r1);
  await p.click(`#heatPanel i[data-k="${once}"]`); await p.waitForTimeout(200);
  ok('Yalnız elle kayıtlı gün: "45 dk (elle 45 dk)"', /45 dk \(elle 45 dk\)/.test((await p.textContent('#heatRead')).replace(/\s+/g, ' ')));
  ok('Sayfa hatası yok', !hatalar.length, hatalar.join(' | '));
  console.log(out.join('\n'));
  await b.close();
})();
