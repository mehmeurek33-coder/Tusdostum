// Kronometre boştayken ders seçimi en son çalışılan derste durur
// Çalıştırma: NODE_PATH="$(npm root -g):<pg'nin olduğu node_modules>" node test/son-ders.js
const { chromium } = require('playwright');
const { baslat } = require('./sahte-supabase.js');
const bekle = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  const S = await baslat(0, {}); const b = await chromium.launch(); const out = [];
  const ok = (a, k, e = '') => out.push(`${k ? 'GEÇTİ ' : 'KALDI '} ${a}${!k && e ? ' — ' + e : ''}`);
  const ctx = await b.newContext({ viewport: { width: 390, height: 780 }, serviceWorkers: 'block' }); const p = await ctx.newPage(); const hata = []; p.on('pageerror', e => hata.push(e.message));
  await p.goto(S.adres + '/'); await p.waitForSelector('#authView');
  await p.click('#authView [data-mode="kayit"]'); await p.fill('#aMail', 's@t.dev'); await p.fill('#aPass', 'gizli123'); await p.click('#aGo');
  await p.waitForSelector('#joinForm', { timeout: 15000 }); await p.fill('#jNick', 'Su'); await p.click('#joinForm button[type=submit]'); await bekle(1200);
  const ders = () => p.evaluate(() => document.querySelector('#tSubject').value);
  ok('Hiç kayıt yokken varsayılan ders (Anatomi)', await ders() === 'anatomi', await ders());
  const uid = S.hesaplar.get('s@t.dev').id, now = Date.now();
  const gun = await p.evaluate(() => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); });
  const dun = await p.evaluate(() => { const d = new Date(Date.now() - 864e5); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); });
  const yaz = async (belge, e) => S.sql(`insert into ozel_belgeler (uid, belge, veri) values ($1, $2, $3) on conflict (uid, belge) do update set veri = jsonb_set(ozel_belgeler.veri, '{entries}', (ozel_belgeler.veri->'entries') || ($3::jsonb->'entries'))`, [uid, belge, { entries: e }]);
  await yaz('kron-' + dun.slice(0, 7), { a: { d: dun, s: 'biyokimya', t: 'konu', m: 50, mm: 50, st: now - 864e5 - 3600e3, en: now - 864e5, b: 0, bn: 0, q: 0, c: 0, w: 0 } });
  await yaz('kron-' + gun.slice(0, 7), { b: { d: gun, s: 'dahiliye', t: 'soru', m: 40, mm: 40, st: now - 3 * 3600e3, en: now - 2 * 3600e3, b: 0, bn: 0, q: 0, c: 0, w: 0 } });
  await p.reload(); await bekle(2500);
  ok('Açılışta ders: en son çalışılan (bugünkü Dahiliye; dünkü Biyokimya değil)', await ders() === 'dahiliye', await ders());
  await yaz('elle-' + gun.slice(0, 7), { c: { d: gun, s: 'patoloji', t: 'konu', m: 30, q: 0, c: 0, w: 0, ts: now - 600e3 } });
  await p.reload(); await bekle(2500);
  ok('Elle girilen daha yeni kayıt da sayılır (Patoloji)', await ders() === 'patoloji', await ders());
  await p.selectOption('#tSubject', 'pediatri'); await bekle(300);
  await p.evaluate(() => window.dispatchEvent(new Event('focus'))); await bekle(500);
  ok('Kişi dersi elle değiştirince seçim korunur', await ders() === 'pediatri', await ders());
  await p.click('[data-act="start"]'); await bekle(1500); await p.click('[data-act="finish"], [data-act="stop"]').catch(() => {});
  ok('Sayfa hatası yok', !hata.length, hata.join(' | '));
  await b.close(); await S.kapat(); console.log(out.join('\n'));
})().catch(e => { console.error(e); process.exit(1); });
