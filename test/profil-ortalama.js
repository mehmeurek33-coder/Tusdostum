// Profil: günlük ortalama ve çalışılan gün, kişinin başladığı günden itibaren (en çok 10 gün) hesaplanır;
// çalışılmayan günler (bugün dahil) ortalamaya katılır.
// Çalıştırma: NODE_PATH=$(npm root -g) node test/profil-ortalama.js
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const F = 'file://' + path.resolve(__dirname, '../index.html');
const out = [];
const ok = (ad, kosul, ek = '') => out.push(`${kosul ? 'GEÇTİ ' : 'KALDI '} ${ad}${!kosul && ek ? ' — ' + ek : ''}`);
const MOCK = /const MOCK = `([\s\S]*?)`;\n/.exec(fs.readFileSync(path.join(__dirname, 'bulut.js'), 'utf8'))[1];
const pad = n => String(n).padStart(2, '0');
const gun = n => { const d = new Date(); d.setHours(12, 0, 0, 0); d.setDate(d.getDate() - n); return d; };
const k = n => { const d = gun(n); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const sonGun = (n, m) => ({ d: k(n), t: [m, 0, 0, 0], s: { patoloji: [m, 0, 0, 0] } });

(async () => {
  const b = await chromium.launch();
  const seed = {
    'logs/u_me': { nick: 'Ben', rooms: ['Dermacı kızlar'], room: 'Dermacı kızlar', migrated: 4, joinedAt: gun(30).getTime(), timer: null },
    // dün katıldı, dün 159 dk, bugün 0
    'logs/u_z': { nick: 'Zaid', rooms: ['Dermacı kızlar'], room: 'Dermacı kızlar', migrated: 4, joinedAt: gun(1).getTime(), timer: null, son: [sonGun(1, 159)] },
    // 30 gün önce katıldı; son 10 günde 3 gün çalıştı (toplam 300 dk), bugün 0
    'logs/u_e': { nick: 'Eski', rooms: ['Dermacı kızlar'], room: 'Dermacı kızlar', migrated: 4, joinedAt: gun(30).getTime(), timer: null, son: [sonGun(8, 100), sonGun(5, 100), sonGun(2, 100)] },
    // 3 gün önce katıldı, bugün de çalıştı: 60 + 60 (bugün) = 120 dk, 4 günün 2'si
    'logs/u_b': { nick: 'Bugünkü', rooms: ['Dermacı kızlar'], room: 'Dermacı kızlar', migrated: 4, joinedAt: gun(3).getTime(), timer: null, son: [sonGun(2, 60), sonGun(0, 60)] },
    // dün katıldı ama yedekten 6 gün öncesine ait kayıt aktarmış
    'logs/u_y': { nick: 'Yedekli', rooms: ['Dermacı kızlar'], room: 'Dermacı kızlar', migrated: 4, joinedAt: gun(1).getTime(), timer: null, son: [sonGun(6, 70), sonGun(1, 50)] },
  };
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true });
  const p = await ctx.newPage();
  const hatalar = []; p.on('pageerror', e => hatalar.push(e.message));
  await p.addInitScript(`window.__mockseed = ${JSON.stringify(seed)}; window.__mockcfg = {};`);
  await p.addInitScript(MOCK);
  await p.addInitScript(() => { localStorage.setItem('tusdostum.pref', JSON.stringify({ welcomed: true, activeRoom: 'dermaci_-ki_zlar' })); });
  await p.goto(F + '#salon'); await p.waitForTimeout(1500);
  const profil = async uid => {
    await p.click(`#onlinePanel [data-profile="${uid}"]`); await p.waitForTimeout(400);
    const r = await p.evaluate(() => Object.fromEntries([...document.querySelectorAll('#profileOverlay .tile')].map(t => [t.querySelector('.l').textContent.trim(), t.querySelector('.v').textContent.trim()])));
    await p.click('#profileOverlay [data-close-prof]'); await p.waitForTimeout(300);
    return r;
  };
  let r = await profil('u_z');
  ok('Dün başlayan (dün 2 sa 39 dk, bugün 0): ortalama 159/2 = 1 sa 20 dk, çalışılan gün 1/2', r['Günlük ortalama'] === '1 sa 20 dk' && r['Çalışılan gün'] === '1/2', JSON.stringify(r));
  r = await profil('u_e');
  ok('Uzun süredir kullanan (10 günde 300 dk, bugün 0): ortalama 300/10 = 30 dk, çalışılan gün 3/10', r['Günlük ortalama'] === '30 dk' && r['Çalışılan gün'] === '3/10', JSON.stringify(r));
  r = await profil('u_b');
  ok('3 gün önce başlayan, bugün de çalışmış (120 dk, 4 gün): ortalama 30 dk, çalışılan gün 2/4', r['Günlük ortalama'] === '30 dk' && r['Çalışılan gün'] === '2/4', JSON.stringify(r));
  r = await profil('u_y');
  ok('Yedekten eski kayıt aktarmış: başlangıç en eski kayıt (6 gün önce) → 120/7 = 17 dk, 2/7', r['Günlük ortalama'] === '17 dk' && r['Çalışılan gün'] === '2/7', JSON.stringify(r));
  ok('Sayfa hatası yok', !hatalar.length, hatalar.join(' | '));
  console.log(out.join('\n'));
  await b.close();
})();
