const { chromium } = require('playwright');
const F = 'file://' + require('path').resolve(__dirname, '../index.html');
const KEY = 'tusdostum.v3';
const OUT = __dirname + '/mobil-ekranlar/';
require('fs').mkdirSync(OUT, { recursive: true });
const log = (...a) => console.log(...a);

function seed() {
  const pad = n => String(n).padStart(2, '0');
  const dk = d => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  const subs = ['anatomi', 'fizyoloji', 'histoloji', 'biyokimya', 'mikrobiyoloji', 'patoloji', 'farmakoloji', 'dahiliye', 'pediatri', 'cerrahi', 'kadin', 'kucuk'];
  const types = ['konu', 'tekrar', 'soru'];
  const kron = {}, manual = {}, hist = {}, subj = {};
  for (let i = 0; i <= 150; i += 2) {
    const d = new Date(); d.setDate(d.getDate() - i); d.setHours(9, 0, 0, 0);
    const key = dk(d), ym = key.slice(0, 7), st = d.getTime();
    const s = subs[i % 12], t = types[i % 3], m = 50 + (i % 7) * 20;
    const q = t === 'soru' ? 60 : 10, c = Math.round(q * 0.72), w = Math.round(q * 0.2);
    kron[ym] = kron[ym] || {};
    kron[ym]['k' + i] = { d: key, s, t, m, mm: m, st, en: st + (m + 12) * 60000, b: 12, bn: 1, q, c, w, n: i % 4 ? '' : 'Zorlandım, tekrar bakılacak', k: i % 3 ? '' : 'Brakiyal pleksus ve dalları' };
    hist[key] = [m, q, c, w];
    subj[s] = subj[s] || [0, 0, 0, 0, 0]; subj[s][0] += m; subj[s][1] += q; subj[s][2] += c; subj[s][3] += w;
  }
  const t0 = new Date(); const tk = dk(t0), tym = tk.slice(0, 7);
  manual[tym] = { e1: { d: tk, s: 'kadin', t: 'konu', m: 45, q: 0, c: 0, w: 0, n: 'Video izledim', k: '', ts: Date.now() } };
  const denemeler = {};
  for (let i = 0; i < 6; i++) { const d = new Date(); d.setDate(d.getDate() - i * 12); denemeler['d' + i] = { n: (6 - i) + '. Genel Deneme Sınavı', d: dk(d), td: 60 + i, ty: 20, kd: 55 + i, ky: 22, ts: Date.now() - i }; }
  const now = Date.now();
  return { root: { nick: 'Mehmet Ürek', room: 'genel', hist, subj,
      timer: { s: 'kadin', t: 'tekrar', st: now - 47 * 60000, runStart: now - 47 * 60000, workMs: 0, breakStart: null, breakMs: 9 * 60000, bn: 1, rev: now } },
    kron, manual, settings: { goalMin: 240, goalQ: 150, examDate: '2027-03-28' }, denemeler };
}

async function audit(p, name) {
  return await p.evaluate((name) => {
    const vw = document.documentElement.clientWidth;
    const res = { name, pageOverflow: document.documentElement.scrollWidth - vw, small: [], tiny: [], clipped: [], hscroll: [] };
    const vis = el => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none'; };
    const top = [...document.querySelectorAll('.overlay:not([hidden])')].pop() || document.body;
    const label = el => (el.id ? '#' + el.id : el.className ? '.' + String(el.className).split(' ').join('.') : el.tagName) + ' "' + (el.textContent || '').trim().slice(0, 18) + '"';
    for (const el of top.querySelectorAll('button, a, select, input, [data-k], rect[data-i]')) {
      if (!vis(el)) continue; const r = el.getBoundingClientRect();
      if (r.height < 40 || r.width < 40) res.small.push(label(el) + ' ' + Math.round(r.width) + 'x' + Math.round(r.height));
    }
    const seen = new Set();
    for (const el of top.querySelectorAll('*')) {
      if (!vis(el) || !el.childNodes.length) continue;
      const hasText = [...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim());
      if (hasText) { const fs = parseFloat(getComputedStyle(el).fontSize); if (fs < 12) { const k = label(el).split(' "')[0] + ' ' + fs; if (!seen.has(k)) { seen.add(k); res.tiny.push(k); } } }
      const r = el.getBoundingClientRect();
      if (r.right > vw + 1 && r.left < vw) { let par = el.parentElement, inScroll = false; while (par) { const o = getComputedStyle(par).overflowX; if (o === 'auto' || o === 'scroll') { inScroll = true; break; } par = par.parentElement; } if (!inScroll) res.clipped.push(label(el) + ' right=' + Math.round(r.right)); }
      const ox = getComputedStyle(el).overflowX;
      if ((ox === 'auto' || ox === 'scroll') && el.scrollWidth > el.clientWidth + 2) res.hscroll.push(label(el).split(' "')[0] + ' ' + el.scrollWidth + '>' + el.clientWidth);
    }
    res.small = [...new Set(res.small)].slice(0, 25); res.clipped = res.clipped.slice(0, 8);
    return res;
  }, name);
}

(async () => {
  const b = await chromium.launch();
  const errs = [];
  for (const W of [390, 320]) {
    const ctx = await b.newContext({ viewport: { width: W, height: 780 }, deviceScaleFactor: 1, isMobile: false, hasTouch: true, colorScheme: 'dark' });
    const p = await ctx.newPage();
    p.on('pageerror', e => errs.push(e.message));
    await p.goto(F);
    await p.evaluate(([k, v]) => localStorage.setItem(k, JSON.stringify(v)), [KEY, seed()]);
    await p.reload(); await p.waitForTimeout(700);
    const shot = async (n, full = true) => { if (W === 390) await p.screenshot({ path: OUT + n + '.png', fullPage: full }); };
    const rep = async n => { const r = await audit(p, n + '@' + W); log(JSON.stringify(r)); };

    await shot('01-bugun'); await rep('bugun');
    await p.click('#tab-salon'); await p.waitForTimeout(400); await shot('02-salon'); await rep('salon');
    await p.click('.rank-row'); await p.waitForTimeout(400); await shot('03-profil', false); await rep('profil');
    await p.click('[data-close-prof]'); await p.waitForTimeout(300);
    await p.click('#tab-dersler'); await p.waitForTimeout(400); await shot('04-dersler'); await rep('dersler');
    await p.click('[data-subj="anatomi"]:visible'); await p.waitForTimeout(500); await shot('05-ders-pencere', false); await rep('ders-pencere');
    await p.click('[data-close-sheet]'); await p.waitForTimeout(300);
    await p.click('#tab-denemeler'); await p.waitForTimeout(400); await shot('06-deneme'); await rep('deneme');
    await p.click('[data-act-den]'); await p.waitForTimeout(300); await shot('07-deneme-form', false); await rep('deneme-form');
    await p.click('#denForm [data-close-modal]'); await p.waitForTimeout(200);
    await p.click('#tab-kayitlar'); await p.waitForTimeout(400); await shot('08-kayitlar', false); await rep('kayitlar');
    await p.click('[data-act-new]'); await p.waitForTimeout(300); await shot('09-elle-form', false); await rep('elle-form');
    await p.click('#entryForm [data-close-modal]'); await p.waitForTimeout(200);
    await p.click('#settingsBtn'); await p.waitForTimeout(300); await shot('10-ayarlar', false); await rep('ayarlar');
    const sheetInfo = await p.evaluate(() => { const s = document.querySelector('#modalOverlay .sheet'); const r = s.getBoundingClientRect(); const btn = s.querySelector('button[type=submit]').getBoundingClientRect(); return { sheetH: Math.round(r.height), scrollH: s.scrollHeight, vh: innerHeight, submitTop: Math.round(btn.top) }; });
    log('ayarlar sheet:', JSON.stringify(sheetInfo));
    await p.click('#setForm [data-close-modal]'); await p.waitForTimeout(200);
    await p.click('#tab-bugun'); await p.waitForTimeout(300);
    await p.click('[data-act="finish"]'); await p.waitForTimeout(400); await shot('11-oturum-form', false); await rep('oturum-form');
    const nav = await p.evaluate(() => { const n = document.querySelector('nav.tabs').getBoundingClientRect(); const t = document.querySelector('.toast'); return { navH: Math.round(n.height), tabH: Math.round(document.querySelector('.tab').getBoundingClientRect().height), headerH: Math.round(document.querySelector('header.top').getBoundingClientRect().height) }; });
    log('nav:', JSON.stringify(nav));
    await ctx.close();
  }
  // yatay (landscape) telefon
  const ctx = await b.newContext({ viewport: { width: 780, height: 360 }, deviceScaleFactor: 1, isMobile: false, hasTouch: true });
  const p = await ctx.newPage();
  await p.goto(F); await p.evaluate(([k, v]) => localStorage.setItem(k, JSON.stringify(v)), [KEY, seed()]); await p.reload(); await p.waitForTimeout(600);
  await p.screenshot({ path: OUT + '12-yatay.png' });
  log('yatay odak görünümü:', await p.evaluate(() => getComputedStyle(document.querySelector('#focusView')).display !== 'none' && document.querySelector('#focusClock').textContent !== '00:00:00' && document.documentElement.scrollWidth <= innerWidth));
  log('ERR', JSON.stringify(errs));
  await b.close();
})();
