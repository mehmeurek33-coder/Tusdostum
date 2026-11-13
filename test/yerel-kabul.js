// TusDostum kabul testleri (yerel mod). Çalıştırma: node test/kabul.js
const { chromium } = require('playwright');
const path = require('path');
const F = 'file://' + path.resolve(__dirname, '../index.html');
const KEY = 'tusdostum.v3';
const out = [];
const ok = (name, cond, extra = '') => { out.push(`${cond ? 'GEÇTİ ' : 'KALDI '} ${name}${extra ? ' — ' + extra : ''}`); };
const pad = n => String(n).padStart(2, '0');
const dk = d => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
const fmtNum = n => Math.round(n).toLocaleString('tr-TR');
const fmtMin = m => { m = Math.round(m || 0); if (m < 60) return `${m} dk`; const h = Math.floor(m / 60), r = m % 60; return r ? `${fmtNum(h)} sa ${r} dk` : `${fmtNum(h)} sa`; };
const SUBS = ['anatomi', 'fizyoloji', 'histoloji', 'biyokimya', 'mikrobiyoloji', 'patoloji', 'farmakoloji', 'dahiliye', 'pediatri', 'cerrahi', 'kadin', 'kucuk'];
const TYPES = ['konu', 'tekrar', 'soru'];

function seed14() {
  const kron = {}; const all = [];
  const add = (id, e) => { const ym = e.d.slice(0, 7); (kron[ym] = kron[ym] || {})[id] = e; all.push(e); };
  let n = 0;
  for (let i = 0; i <= 425; i += 3) {          // ~14 ay
    const d = new Date(); d.setDate(d.getDate() - i); d.setHours(9 + (i % 5), 0, 0, 0);
    const s = SUBS[n % 12], t = TYPES[n % 3], m = 30 + (n % 7) * 15;
    const q = t === 'soru' ? Math.min(2 * m, 40 + (n % 5) * 10) : (n % 4 === 0 ? 10 : 0);
    const c = Math.round(q * 0.7), w = Math.round(q * 0.2);
    const st = d.getTime();
    add('k' + n, { d: dk(d), s, t, m, mm: m, st, en: st + (m + 10) * 60000, b: 10, bn: 1, q, c, w, n: '', k: n % 6 === 0 ? 'Konu ' + (n % 4) : '', ts: st });
    n++;
  }
  // A3: çakışan iki oturum + günü st ile uyuşmayan bir oturum (kendi görünümünde DURMALI)
  const y = new Date(); y.setDate(y.getDate() - 1); y.setHours(14, 0, 0, 0);
  add('ovA', { d: dk(y), s: 'patoloji', t: 'konu', m: 60, mm: 60, st: y.getTime(), en: y.getTime() + 60 * 60000, b: 0, bn: 0, q: 0, c: 0, w: 0, ts: y.getTime() });
  add('ovB', { d: dk(y), s: 'patoloji', t: 'konu', m: 40, mm: 40, st: y.getTime() + 20 * 60000, en: y.getTime() + 60 * 60000, b: 0, bn: 0, q: 0, c: 0, w: 0, ts: y.getTime() + 1 });
  const z = new Date(); z.setDate(z.getDate() - 6); z.setHours(10, 0, 0, 0);
  const wrongD = new Date(z); wrongD.setDate(wrongD.getDate() - 3);
  add('dayX', { d: dk(wrongD), s: 'anatomi', t: 'tekrar', m: 25, mm: 25, st: z.getTime(), en: z.getTime() + 25 * 60000, b: 0, bn: 0, q: 0, c: 0, w: 0, ts: z.getTime() });
  return { kron, all };
}

(async () => {
  const b = await chromium.launch();
  const errs = [];
  // ---------- 1) Masaüstü: istatistik tutarlılığı ----------
  {
    const ctx = await b.newContext({ viewport: { width: 1280, height: 900 } });
    await ctx.addInitScript(() => { Object.defineProperty(window, 'TUSDOSTUM_AYAR', { get: () => ({}), set: () => {}, configurable: false }); });   // yerel mod: gerçek sunucuya bağlanma
    const p = await ctx.newPage();
    p.on('pageerror', e => errs.push('1:' + e.message));
    const { kron, all } = seed14();
    await p.goto(F);
    await p.evaluate(([k, v]) => { localStorage.clear(); localStorage.setItem(k, JSON.stringify(v)); }, [KEY, { root: { nick: 'Test' }, kron, manual: {}, settings: {}, denemeler: {} }]);
    await p.reload(); await p.waitForTimeout(700);
    await p.click('#tab-dersler'); await p.waitForTimeout(400);
    await p.click('[data-period="tumu"]'); await p.waitForTimeout(300);
    const expAll = all.reduce((x, e) => x + e.m, 0);
    const tile = (await p.textContent('#panel-dersler .tiles .tile .v')).trim();
    const foot = (await p.textContent('#panel-dersler tfoot td:last-child')).trim();
    ok('B2 Tümü toplamı = bütün kayıtlar (A3 dahil)', tile === fmtMin(expAll), `${tile} / beklenen ${fmtMin(expAll)}`);
    ok('B2 Kart üstü toplam = döküm tablosu toplam satırı', tile === foot, `${tile} / ${foot}`);
    const rowSum = await p.evaluate(() => {
      const parse = t => { t = t.trim(); let m = 0; const h = t.match(/([\d.]+) sa/); const d = t.match(/(\d+) dk/); if (h) m += +h[1].replace(/\./g, '') * 60; if (d) m += +d[1]; return m; };
      return [...document.querySelectorAll('#panel-dersler .desk-only tbody tr td:last-child')].reduce((x, td) => x + parse(td.textContent), 0);
    });
    ok('B2 Ders satırları toplamı = toplam satırı', fmtMin(rowSum) === foot, fmtMin(rowSum));
    // ders penceresi: aylık tablo toplamı = döküm satırı
    for (const s of ['anatomi', 'patoloji']) {
      const exp = all.filter(e => e.s === s);
      const expKonu = exp.filter(e => e.t === 'konu').reduce((x, e) => x + e.m, 0);
      await p.click(`[data-subj="${s}"]`); await p.waitForTimeout(500);
      const months = await p.evaluate(() => [...document.querySelectorAll('#sheetOverlay .tbl tbody tr')].length);
      const konuFoot = (await p.textContent('#sheetOverlay table:first-of-type tfoot td:nth-child(2)').catch(() => '')).trim();
      const footCell = await p.evaluate(() => { const t = [...document.querySelectorAll('#sheetOverlay table')].find(x => x.querySelector('th') && x.querySelector('th').textContent === 'Ay'); return t ? t.querySelector('tfoot td:nth-child(2)').textContent.trim() : ''; });
      ok(`B2 ${s}: ay ay tablo konu toplamı = kayıtlar`, footCell === fmtMin(expKonu), `${footCell} / ${fmtMin(expKonu)}`);
      ok(`B2 ${s}: ay tablosunda 14+ ay`, months >= 14, String(months));
      await p.click('#sheetOverlay .sheet-head [data-close-sheet]'); await p.waitForTimeout(300);
    }
    // tek ay
    const ym = (() => { const d = new Date(); d.setMonth(d.getMonth() - 5, 1); return dk(d).slice(0, 7); })();
    await p.selectOption('#periodMonth', 'm:' + ym); await p.waitForTimeout(400);
    const tileM = (await p.textContent('#panel-dersler .tiles .tile .v')).trim();
    const expM = all.filter(e => e.d.startsWith(ym)).reduce((x, e) => x + e.m, 0);
    ok('B2 Tek ay seçimi yalnızca o ayı sayıyor', tileM === fmtMin(expM), `${tileM} / ${fmtMin(expM)}`);
    await p.click('[data-period="tumu"]');
    // Kayıtlar: 14 ay öncesine git
    await p.click('#tab-kayitlar'); await p.waitForTimeout(300);
    const opts = await p.evaluate(() => [...document.querySelectorAll('#logMonth option')].map(o => o.value));
    ok('B2 Kayıtlar ay listesi ilk kayıt ayına kadar', opts.length >= 14, `${opts.length} ay`);
    await p.selectOption('#logMonth', opts[opts.length - 1]); await p.waitForTimeout(300);
    const oldCount = await p.evaluate(() => document.querySelectorAll('#logPanel .entry').length);
    ok('B2 En eski aydaki kayıtlar görünüyor', oldCount > 0, String(oldCount));
    await p.selectOption('#logMonth', opts[0]); await p.waitForTimeout(300);
    const tags = await p.evaluate(() => [...document.querySelectorAll('#logPanel .tag')].filter(t => t.textContent.includes('sıralamaya girmedi')).length);
    ok('A3 Denetime takılan kayıt atılmıyor, etiketleniyor', tags >= 1, `${tags} etiket`);
    // B4: rozetler
    const badges = await p.evaluate(() => document.querySelectorAll('#logPanel .entry .sb').length === document.querySelectorAll('#logPanel .entry').length);
    ok('B4 Her kayıt satırında ders rozeti var', badges);
    await p.click('#tab-dersler'); await p.waitForTimeout(300);
    await p.screenshot({ path: path.join(__dirname, 'ekran-dersler.png'), fullPage: true });
    await ctx.close();
  }
  // ---------- 2) Telefon: yeni kullanıcı (3 gün), takvim, profil, gece yarısı, şerit, odak ----------
  {
    const ctx = await b.newContext({ viewport: { width: 390, height: 780 }, hasTouch: true, colorScheme: 'dark' });
    await ctx.addInitScript(() => { Object.defineProperty(window, 'TUSDOSTUM_AYAR', { get: () => ({}), set: () => {}, configurable: false }); });   // yerel mod: gerçek sunucuya bağlanma
    const p = await ctx.newPage();
    p.on('pageerror', e => errs.push('2:' + e.message));
    const kron = {};
    for (let i = 1; i <= 3; i++) {
      const d = new Date(); d.setDate(d.getDate() - i); d.setHours(10, 0, 0, 0);
      const ym = dk(d).slice(0, 7); (kron[ym] = kron[ym] || {})['n' + i] = { d: dk(d), s: SUBS[i], t: 'konu', m: 50, mm: 50, st: d.getTime(), en: d.getTime() + 55 * 60000, b: 5, bn: 1, q: 0, c: 0, w: 0, ts: d.getTime() };
    }
    const y = new Date(); y.setDate(y.getDate() - 1); y.setHours(23, 0, 0, 0);
    await p.goto(F);
    await p.evaluate(([k, v]) => { localStorage.clear(); localStorage.setItem(k, JSON.stringify(v)); }, [KEY, { root: { nick: 'Yeni', timer: { s: 'kadin', t: 'soru', st: y.getTime(), runStart: y.getTime(), workMs: 0, breakStart: null, breakMs: 0, bn: 0 } }, kron, manual: {}, settings: {}, denemeler: {} }]);
    await p.reload(); await p.waitForTimeout(700);
    const heat = await p.evaluate(() => {
      const keys = [...document.querySelectorAll('#heatPanel i[data-k]')].map(i => i.dataset.k).sort();
      const g = document.querySelector('#heatPanel .heat').getBoundingClientRect(), pn = document.querySelector('#heatPanel').getBoundingClientRect();
      return { title: document.querySelector('#heatPanel h2').textContent, sub: document.querySelector('#heatPanel .panel-head .small').textContent, first: keys[0], n: keys.length, fits: g.right <= pn.right + 0.5 };
    });
    const exp1 = dk(new Date(Date.now() - 3 * 864e5));
    ok('B1 Takvim ilk günden başlıyor', heat.first === exp1 && heat.title === 'Başladığından beri', `${heat.title} · ${heat.sub} · ilk ${heat.first} · ${heat.n} kare`);
    ok('B1 Takvim kutuya sığıyor (390 px)', heat.fits);
    // gece yarısı bölme
    await p.click('[data-act="finish"]'); await p.waitForTimeout(400);
    const splitNote = await p.evaluate(() => document.querySelector('#entryForm').textContent.includes('gece yarısını aştı'));
    const active = await p.evaluate(() => document.activeElement && document.activeElement.tagName);
    const coarse = await p.evaluate(() => matchMedia('(pointer: coarse)').matches);
    ok('M1.3 Form açılınca giriş alanı odaklanmıyor (dokunmatik)', active !== 'INPUT', `odak: ${active}, pointer:coarse=${coarse}`);
    const footVis = await p.evaluate(() => { const r = document.querySelector('#entryForm button[type=submit]').getBoundingClientRect(); return r.bottom <= innerHeight && r.top >= 0; });
    ok('M2 Kaydet düğmesi kaydırmadan görünüyor', footVis);
    ok('C3 Gece yarısı uyarısı formda', splitNote);
    await p.fill('#fQ', '20'); await p.fill('#fC', '12'); await p.fill('#fW', '5');
    await p.click('#entryForm button[type=submit]'); await p.waitForTimeout(500);
    const toastTxt = (await p.textContent('#toast')).trim();
    ok('C3 Oturum iki güne bölündü', toastTxt.includes('iki güne'), toastTxt);
    const saved = await p.evaluate(k => { const v = JSON.parse(localStorage.getItem(k)); const all = []; for (const ym in v.kron) for (const id in v.kron[ym]) if (!v.kron[ym][id].del) all.push(v.kron[ym][id]); return all.filter(e => e.s === 'kadin').map(e => ({ d: e.d, m: e.m, mm: e.mm, q: e.q, span: Math.round((e.en - e.st) / 60000) })); }, KEY);
    ok('C3 Bölünmüş parçalar sıkı denetimden geçer (m≤mm≤süre, soru≤2m)', saved.length === 2 && saved.every(e => e.m <= e.mm && e.mm <= e.span + 1 && e.q <= e.m * 2), JSON.stringify(saved));
    // şerit
    await p.click('[data-act="start"]'); await p.waitForTimeout(300);
    await p.click('#tab-salon'); await p.waitForTimeout(1300);
    const strip = await p.evaluate(() => { const s = document.querySelector('#timerStrip'); return { vis: !s.hidden, t: (document.querySelector('#stripTime') || {}).textContent }; });
    ok('M5 Kronometre şeridi Salon sekmesinde görünüyor ve akıyor', strip.vis && strip.t && strip.t !== '00:00:00', JSON.stringify(strip));
    // profil
    await p.click('#onlinePanel [data-profile]'); await p.waitForTimeout(500);
    const prof = await p.evaluate(() => {
      const ov = document.querySelector('#profileOverlay');
      return { days: ov.querySelectorAll('.pday').length, subj: ov.querySelectorAll('.dist .r').length, txt: ov.textContent.includes('Son 10 gün'), sheetW: ov.querySelector('.sheet-body').scrollWidth, bodyW: ov.querySelector('.sheet-body').clientWidth, closeH: ov.querySelector('.close').getBoundingClientRect().height };
    });
    ok('B3 Profilde 10 günlük liste ve ders dağılımı', prof.days === 10 && prof.subj >= 1 && prof.txt, JSON.stringify(prof));
    ok('M1.1 Profil penceresi yana kaymıyor', prof.sheetW <= prof.bodyW + 1, `${prof.sheetW} / ${prof.bodyW}`);
    ok('M3 Kapat düğmesi ≥ 44 px', prof.closeH >= 44, String(prof.closeH));
    await p.screenshot({ path: path.join(__dirname, 'ekran-profil-mobil.png') });
    await p.click('[data-close-prof]'); await p.waitForTimeout(300);
    const shared = await p.evaluate(k => { const r = JSON.parse(localStorage.getItem(k)).root; return { son: (r.son || []).map(x => x.d), hist: r.hist, subj: r.subj, dayN: r.day && r.day.e && r.day.e.length }; }, KEY);
    const tenAgo = dk(new Date(Date.now() - 9 * 864e5));
    ok('B3 Ortak özet yalnızca son 10 gün, hist/subj yok', shared.son.every(d => d >= tenAgo) && !shared.hist && !shared.subj, JSON.stringify(shared));
    await p.click('#tab-bugun'); await p.waitForTimeout(300);
    await p.screenshot({ path: path.join(__dirname, 'ekran-bugun-mobil.png'), fullPage: true });
    await ctx.close();
  }
  // ---------- 3) Uzun geçmiş: takvim penceresi ----------
  for (const W of [1280, 390]) {
    const ctx = await b.newContext({ viewport: { width: W, height: 900 }, hasTouch: W < 500 });
    await ctx.addInitScript(() => { Object.defineProperty(window, 'TUSDOSTUM_AYAR', { get: () => ({}), set: () => {}, configurable: false }); });   // yerel mod: gerçek sunucuya bağlanma
    const p = await ctx.newPage();
    p.on('pageerror', e => errs.push('3:' + e.message));
    const { kron } = seed14();
    await p.goto(F);
    await p.evaluate(([k, v]) => { localStorage.clear(); localStorage.setItem(k, JSON.stringify(v)); }, [KEY, { root: {}, kron, manual: {}, settings: {}, denemeler: {} }]);
    await p.reload(); await p.waitForTimeout(700);
    const h = await p.evaluate(() => { const g = document.querySelector('#heatPanel .heat'), pn = document.querySelector('#heatPanel'); const cell = g.querySelector('i').getBoundingClientRect().width; return { title: document.querySelector('#heatPanel h2').textContent, cols: getComputedStyle(g).gridTemplateColumns.split(' ').length - 1, cell: Math.round(cell * 10) / 10, fits: g.getBoundingClientRect().right <= pn.getBoundingClientRect().right + 0.5 }; });
    ok(`B1 Uzun geçmişte takvim (${W}px)`, (W > 800 ? h.title === 'Son 6 ay' && h.cols === 26 : h.title.startsWith('Son ')) && h.fits && h.cell >= 12, JSON.stringify(h));
    await ctx.close();
  }
  ok('Konsol/sayfa hatası yok', errs.length === 0, errs.join(' | '));
  console.log(out.join('\n'));
  await b.close();
})();
