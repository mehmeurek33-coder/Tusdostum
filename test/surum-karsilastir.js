// GÜNCELLEME ÖNCESİ DENETİM: yayındaki sürüm ile yeni sürüm aynı kayıtlarla açılır; kullanıcının gördüğü
// bütün istatistikler, kayıt listeleri ve denemeler birebir aynı olmalı, sunucudaki veri değişmemeli.
// Ayrıca veritabanı şeması yeniden uygulanınca kayıtların değişmediği denetlenir.
// Çalıştırma: NODE_PATH="$(npm root -g):<pg'nin olduğu node_modules>" node test/surum-karsilastir.js <eski_klasör> [yeni_klasör]
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path');
const { baslat } = require('./sahte-supabase.js');
const ESKI = path.resolve(process.argv[2] || '');
const YENI = path.resolve(process.argv[3] || path.join(__dirname, '..'));
if (!process.argv[2] || !fs.existsSync(path.join(ESKI, 'index.html'))) { console.error('Kullanım: node test/surum-karsilastir.js <eski_klasör> [yeni_klasör]'); process.exit(2); }
const out = [];
const ok = (ad, kosul, ek = '') => out.push(`${kosul ? 'GEÇTİ ' : 'KALDI '} ${ad}${!kosul && ek ? ' — ' + ek : ''}`);
const bekle = ms => new Promise(r => setTimeout(r, ms));
const pad = n => String(n).padStart(2, '0');
const dkey = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const SUBJ = ['anatomi', 'fizyoloji', 'histoloji', 'biyokimya', 'mikrobiyoloji', 'patoloji', 'farmakoloji', 'dahiliye', 'pediatri', 'cerrahi', 'kadin', 'kucuk'];
let tohum = 7; const rnd = () => (tohum = (tohum * 1103515245 + 12345) % 2147483648) / 2147483648;
const sec = a => a[Math.floor(rnd() * a.length)];

function veriUret() {
  const bugun = new Date(); bugun.setHours(0, 0, 0, 0);
  const belge = {}; let id = 0;
  const ekle = (ad, k, v) => { const b = belge[ad] || (belge[ad] = { ym: ad.slice(5), entries: {} }); b.entries[k] = v; };
  for (let g = 420; g >= 1; g--) {
    const d = new Date(bugun); d.setDate(d.getDate() - g);
    const k = dkey(d), ym = k.slice(0, 7);
    let saat = 7 + Math.floor(rnd() * 3);
    for (let i = 0, n = Math.floor(rnd() * 5); i < n; i++) {
      const t = sec(['konu', 'tekrar', 'soru']), s = sec(SUBJ);
      const mm = 15 + Math.floor(rnd() * 160), m = Math.max(1, mm - Math.floor(rnd() * 12));
      const q = t === 'soru' ? Math.floor(rnd() * Math.min(250, m * 2)) : (rnd() < 0.2 ? Math.floor(rnd() * 25) : 0);
      const c = Math.floor(rnd() * (q + 1)), w = Math.floor(rnd() * (q - c + 1));
      const st = new Date(d); st.setHours(saat, Math.floor(rnd() * 50), 0, 0);
      const en = st.getTime() + (mm + Math.floor(rnd() * 20)) * 60000;
      saat = new Date(en).getHours() + 1; if (saat > 22) break;
      const e = { d: k, s, t, m, mm, st: st.getTime(), en, b: Math.floor(rnd() * 20), bn: Math.floor(rnd() * 3), q, c, w, n: rnd() < 0.1 ? 'not ğüşiöç' : '', k: rnd() < 0.2 ? 'Konu ' + i : '', ts: st.getTime() };
      ekle('kron-' + ym, 'k' + (id++), rnd() < 0.04 ? { del: 1, ts: 1 } : e);
    }
    if (rnd() < 0.15) {
      const t = sec(['konu', 'tekrar', 'soru']), q = t === 'soru' ? Math.floor(rnd() * 90) : 0, c = Math.floor(rnd() * (q + 1));
      ekle('elle-' + ym, 'm' + (id++), rnd() < 0.05 ? { del: 1, ts: 1 } : { d: k, s: sec(SUBJ), t, m: 10 + Math.floor(rnd() * 100), q, c, w: Math.floor(rnd() * (q - c + 1)), n: '', k: '', ts: id });
    }
  }
  const items = {};
  for (let i = 0; i < 14; i++) { const d = new Date(bugun); d.setDate(d.getDate() - i * 25 - 3); items['d' + i] = { n: 'Deneme ' + (i + 1), d: dkey(d), td: 40 + Math.floor(rnd() * 60), ty: Math.floor(rnd() * 30), kd: 40 + Math.floor(rnd() * 60), ky: Math.floor(rnd() * 30), ts: i }; }
  belge.denemeler = { items };
  belge.ayar = { goalMin: 300, goalQ: 120, examDate: '2027-03-28', breakWarn: 10, workWarn: 50 };
  return belge;
}

// Kullanıcının gördüğü istatistiklerin "parmak izi"
async function parmakIzi(p) {
  const iz = {};
  await p.evaluate(() => { location.hash = 'dersler'; }); await bekle(600);
  for (const elle of [false, true]) {
    const cb = await p.$('#incManual');
    if ((await cb.isChecked()) !== elle) { await cb.click(); await bekle(300); }
    for (const d of ['hafta', 'ay', '3ay', '12ay', 'tumu']) {
      await p.click(`[data-period="${d}"]`); await bekle(250);
      iz[`dersler/${d}/${elle ? 'elle' : 'kron'}`] = await p.evaluate(() => [...document.querySelectorAll('#panel-dersler .tile, #panel-dersler table.tbl tbody tr, #panel-dersler table.tbl tfoot tr, #panel-dersler .side-note')].map(e => e.textContent.replace(/\s+/g, ' ').trim()).join(' | '));
    }
    const aylar = await p.evaluate(() => [...document.querySelectorAll('#periodMonth option')].map(o => o.value).filter(Boolean).slice(0, 6));
    for (const m of aylar) { await p.selectOption('#periodMonth', m); await bekle(250); iz[`dersler/${m}/${elle ? 'elle' : 'kron'}`] = await p.evaluate(() => [...document.querySelectorAll('#panel-dersler .tile, #panel-dersler table.tbl tbody tr, #panel-dersler table.tbl tfoot tr')].map(e => e.textContent.replace(/\s+/g, ' ').trim()).join(' | ')); }
    // ders ayrıntı pencereleri
    for (const s of ['anatomi', 'dahiliye', 'kucuk']) {
      await p.click(`[data-period="tumu"]`); await bekle(200);
      await p.click(`#panel-dersler table.tbl tbody tr[data-subj="${s}"]`); await bekle(400);
      iz[`ders-penceresi/${s}/${elle ? 'elle' : 'kron'}`] = await p.evaluate(() => { const el = document.querySelector('#sheetOverlay'); return el ? [...el.querySelectorAll('.tile, .tbl tr, .mrow')].map(e => e.textContent.replace(/\s+/g, ' ').trim()).join(' | ') : ''; });
      await p.keyboard.press('Escape'); await p.evaluate(() => { const c = document.querySelector('#sheetOverlay [data-close-sheet]'); if (c) c.click(); }); await bekle(300);
    }
  }
  await p.evaluate(() => { location.hash = 'kayitlar'; }); await bekle(500);
  for (let i = 0; i < 8; i++) {
    iz[`kayitlar/${i}`] = await p.evaluate(() => [...document.querySelectorAll('#logPanel .entry, #logPanel h2, #logPanel .panel-head')].map(e => e.textContent.replace(/\s+/g, ' ').trim()).join(' | '));
    const g = await p.$('[data-mnav="older"]:not([disabled])'); if (!g) break; await g.click(); await bekle(300);
  }
  await p.evaluate(() => { location.hash = 'denemeler'; }); await bekle(500);
  iz.denemeler = await p.evaluate(() => document.querySelector('#denemePanel').textContent.replace(/\s+/g, ' ').trim());
  return iz;
}

(async () => {
  const S = await baslat(0, { kok: ESKI });
  const b = await chromium.launch();
  const hatalar = [];
  const ac = async () => {
    const ctx = await b.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: 'block' });
    const p = await ctx.newPage(); p.on('pageerror', e => hatalar.push(e.message));
    await p.goto(S.adres + '/'); return p;
  };
  try {
    // Kullanıcıyı yayındaki sürümle aç, sonra geçmişe dönük ~14 aylık kayıtları sunucuya koy
    let p = await ac();
    await p.waitForSelector('#authView');
    await p.click('#authView [data-mode="kayit"]'); await p.fill('#aMail', 's@test.dev'); await p.fill('#aPass', 'gizli123'); await p.click('#aGo');
    await p.waitForSelector('#joinForm', { timeout: 15000 }); await p.fill('#jNick', 'Sürüm'); await p.click('#joinForm button[type=submit]'); await bekle(800);
    const uid = S.hesaplar.get('s@test.dev').id;
    const veri = veriUret();
    for (const [belge, v] of Object.entries(veri)) await S.sql(`insert into ozel_belgeler (uid, belge, veri) values ($1, $2, $3) on conflict (uid, belge) do update set veri = excluded.veri`, [uid, belge, JSON.stringify(v)]);
    const ozet = async () => (await S.sql(`select md5(string_agg(belge || ':' || veri::text, '|' order by belge)) as h, count(*)::int as n from ozel_belgeler where uid = $1 and belge <> 'kronometre'`, [uid]))[0];
    await p.context().close();

    // ESKİ sürüm
    p = await ac();
    await p.waitForSelector('#authView'); await p.fill('#aMail', 's@test.dev'); await p.fill('#aPass', 'gizli123'); await p.click('#aGo');
    await p.waitForFunction(() => !document.querySelector('#authView'), null, { timeout: 15000 }); await bekle(2500);
    const izEski = await parmakIzi(p);
    await bekle(1500);
    const vEski = await ozet();
    await p.context().close();

    // Sunucu şemasını yeniden uygula (sunucu güncellemesi) → veri değişmemeli
    const { Client } = require('pg');
    const c = new Client({ host: '127.0.0.1', port: 5432, user: 'postgres', password: process.env.PGPASSWORD || 'test', database: 'tdtest_e2e' });
    await c.connect(); await c.query('set client_min_messages = error'); await c.query(fs.readFileSync(path.join(YENI, 'supabase/schema.sql'), 'utf8')); await c.end();
    const vSema = await ozet();
    ok('Yeni veritabanı şeması uygulanınca kayıtlar birebir aynı', vSema.h === vEski.h, JSON.stringify([vEski, vSema]));

    // YENİ sürüm
    S.kokDegistir(YENI);
    p = await ac();
    await p.waitForSelector('#authView'); await p.fill('#aMail', 's@test.dev'); await p.fill('#aPass', 'gizli123'); await p.click('#aGo');
    await p.waitForFunction(() => !document.querySelector('#authView'), null, { timeout: 15000 }); await bekle(2500);
    const izYeni = await parmakIzi(p);
    await bekle(1500);
    const vYeni = await ozet();
    await p.context().close();

    const anahtarlar = Object.keys(izEski);
    const farkli = anahtarlar.filter(k => izEski[k] !== izYeni[k]);
    const bos = anahtarlar.filter(k => !izEski[k]);
    ok(`Yeni sürüm açılınca sunucudaki kayıtlar birebir aynı (${vEski.n} belge)`, vYeni.h === vEski.h, JSON.stringify([vEski, vYeni]));
    ok(`Kullanıcının gördüğü ${anahtarlar.length} ekranın hepsi iki sürümde birebir aynı (istatistik, ders ayrıntısı, kayıtlar, denemeler)`,
      farkli.length === 0 && anahtarlar.length >= 30 && bos.length < 3,
      farkli.slice(0, 3).map(k => `${k}\n   ESKİ: ${String(izEski[k]).slice(0, 300)}\n   YENİ: ${String(izYeni[k]).slice(0, 300)}`).join('\n') + (bos.length ? ` | boş: ${bos.join(',')}` : ''));
    ok('Sayfa hatası yok', hatalar.length === 0, hatalar.join(' | '));
  } catch (e) { ok('Test akışı tamamlandı', false, (e && e.stack) || String(e)); }
  console.log(`Eski: ${ESKI}\nYeni: ${YENI}`);
  console.log(out.join('\n'));
  console.log(`\n${out.filter(x => x.startsWith('GEÇTİ')).length} geçti, ${out.filter(x => x.startsWith('KALDI')).length} kaldı`);
  await b.close(); await S.kapat();
})();
