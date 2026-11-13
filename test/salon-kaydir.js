// Salon: odadakiler bugünkü süreye göre çoktan aza; parmakla sağa/sola kaydırınca odalar arası geçiş.
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

(async () => {
  const b = await chromium.launch();
  const now = Date.now();
  const gun = (m, st) => ({ d: bugun, e: [{ id: 'x' + m, d: bugun, s: 'anatomi', t: 'konu', m, mm: m, st, en: st + (m + 2) * 60000, b: 0, q: 0, c: 0, w: 0 }] });
  const bas = (() => { const d = new Date(); d.setHours(0, 30, 0, 0); return d.getTime(); })();
  const seed = {
    'logs/u_me': { nick: 'Ben', rooms: ['Kızlar', 'TSM'], room: 'Kızlar', migrated: 4, joinedAt: 1, timer: null },
    'logs/u_a': { nick: 'Ayşe', rooms: ['Kızlar'], room: 'Kızlar', migrated: 4, timer: null, day: gun(30, bas) },
    'logs/u_b': { nick: 'Burak', rooms: ['Kızlar'], room: 'Kızlar', migrated: 4, timer: null, day: gun(90, bas) },
    'logs/u_c': { nick: 'Cem', rooms: ['Kızlar'], room: 'Kızlar', migrated: 4, timer: { s: 'pediatri', t: 'konu', st: now - 3600e3, runStart: now - 50 * 60000, workMs: 0, breakStart: null, breakMs: 0, bn: 0 } },
    'logs/u_d': { nick: 'Deniz', rooms: ['TSM'], room: 'TSM', migrated: 4, timer: null, day: gun(15, bas) },
  };
  const ctx = await b.newContext({ viewport: { width: 390, height: 800 }, hasTouch: true });
  const p = await ctx.newPage();
  const hatalar = []; p.on('pageerror', e => hatalar.push(e.message));
  await p.addInitScript(`window.__mockseed = ${JSON.stringify(seed)}; window.__mockcfg = {};`);
  await p.addInitScript(MOCK);
  await p.addInitScript(() => { localStorage.setItem('tusdostum.pref', JSON.stringify({ welcomed: true, activeRoom: 'genel' })); });
  await p.goto(F + '#salon'); await p.waitForTimeout(1500);
  const durum = () => p.evaluate(() => ({ oda: document.querySelector('#onlinePanel h2').textContent, sekme: (document.querySelector('.rtabs [aria-pressed="true"]') || {}).textContent, kisiler: [...document.querySelectorAll('#onlinePanel .person .nm')].map(x => x.textContent.replace('sen', '').trim()) }));
  const kaydir = (dx, dy = 0, x0 = 200) => p.evaluate(([dx, dy, x0]) => {
    const el = document.querySelector('#onlinePanel .person') || document.querySelector('#onlinePanel');
    const t = (x, y) => new Touch({ identifier: 1, target: el, clientX: x, clientY: y });
    el.dispatchEvent(new TouchEvent('touchstart', { touches: [t(x0, 400)], changedTouches: [t(x0, 400)], bubbles: true }));
    el.dispatchEvent(new TouchEvent('touchend', { touches: [], changedTouches: [t(x0 + dx, 400 + dy)], bubbles: true }));
  }, [dx, dy, x0]);

  ok('Ayrı "Canlı sıralama" paneli yok', !(await p.$('#rankPanel')) && !/Canlı sıralama/.test(await p.textContent('#panel-salon')));
  let d = await durum();
  ok('Başlangıç: Genel', d.oda === 'Genel' && d.sekme === 'Genel', JSON.stringify(d));
  ok('Genel\'de herkes bugünkü süreye göre çoktan aza: Burak 90, Cem 50 (canlı), Ayşe 30, Deniz 15, Ben 0', JSON.stringify(d.kisiler) === JSON.stringify(['Burak', 'Cem', 'Ayşe', 'Deniz', 'Ben']), JSON.stringify(d.kisiler));
  await kaydir(-120); await p.waitForTimeout(400); d = await durum();
  ok('Sola kaydırınca sonraki oda: Kızlar', d.oda === 'Kızlar odası' && d.sekme === 'Kızlar', JSON.stringify(d));
  ok('Kızlar odasında da çoktan aza (Deniz yok)', JSON.stringify(d.kisiler) === JSON.stringify(['Burak', 'Cem', 'Ayşe', 'Ben']), JSON.stringify(d.kisiler));
  await kaydir(-120); await p.waitForTimeout(400); d = await durum();
  ok('Bir daha sola: TSM', d.oda === 'TSM odası' && JSON.stringify(d.kisiler) === JSON.stringify(['Deniz', 'Ben']), JSON.stringify(d));
  await kaydir(-120); await p.waitForTimeout(400); d = await durum();
  ok('Son odada sola kaydırınca yerinde kalıyor', d.oda === 'TSM odası', JSON.stringify(d));
  await kaydir(120); await p.waitForTimeout(400); d = await durum();
  ok('Sağa kaydırınca önceki oda: Kızlar', d.oda === 'Kızlar odası', JSON.stringify(d));
  await kaydir(30); await p.waitForTimeout(300); d = await durum();
  ok('Kısa hareket oda değiştirmiyor', d.oda === 'Kızlar odası', JSON.stringify(d));
  await kaydir(100, 160); await p.waitForTimeout(300); d = await durum();
  ok('Aşağı/yukarı kaydırma (sayfayı gezinme) oda değiştirmiyor', d.oda === 'Kızlar odası', JSON.stringify(d));
  await kaydir(150, 0, 8); await p.waitForTimeout(300); d = await durum();
  ok('Ekran kenarından başlayan hareket oda değiştirmiyor', d.oda === 'Kızlar odası', JSON.stringify(d));
  await p.waitForTimeout(5500); d = await durum();
  ok('5 sn sonraki yenilemede seçili oda ve sıra korunuyor', d.oda === 'Kızlar odası' && d.kisiler[0] === 'Burak', JSON.stringify(d));
  ok('Sayfa hatası yok', !hatalar.length, hatalar.join(' | '));
  console.log(out.join('\n'));
  await b.close();
})();
