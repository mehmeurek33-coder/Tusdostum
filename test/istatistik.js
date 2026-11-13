// İstatistik doğruluğu: rastgele üretilmiş ~13 aylık kayıtla, uygulamanın Dersler ekranında gösterdiği her sayı
// bağımsız olarak hesaplananla karşılaştırılır (her dönem, elle kayıtlar dahil/hariç, ders ders).
// Çalıştırma: NODE_PATH=$(npm root -g) node test/istatistik.js
const { chromium } = require('playwright');
const path = require('path');
const F = 'file://' + path.resolve(__dirname, '../index.html');
const out = [];
const ok = (ad, kosul, ek = '') => out.push(`${kosul ? 'GEÇTİ ' : 'KALDI '} ${ad}${!kosul && ek ? ' — ' + ek : ''}`);
const pad = n => String(n).padStart(2, '0');
const dkey = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const SUBJ = ['anatomi', 'fizyoloji', 'histoloji', 'biyokimya', 'mikrobiyoloji', 'patoloji', 'farmakoloji', 'dahiliye', 'pediatri', 'cerrahi', 'kadin', 'kucuk'];

// Tekrarlanabilir rastgele sayı
let tohum = 20261113; const rnd = () => (tohum = (tohum * 1103515245 + 12345) % 2147483648) / 2147483648;
const sec = a => a[Math.floor(rnd() * a.length)];

(async () => {
  const b = await chromium.launch();
  const p0 = await b.newPage(); await p0.goto(F);
  const SUBJECTS = await p0.evaluate(() => [...document.querySelectorAll('#fS option, option')].length);   // yalnızca sayfanın açıldığını doğrular
  await p0.close();

  // --- Veri üret: geçmiş 400 gün, günde 0–4 kronometreli oturum + bazen elle kayıt, bazıları silinmiş ---
  const bugun = new Date(); bugun.setHours(0, 0, 0, 0);
  const kron = {}, manual = {}, gercek = [];                       // gercek: istatistiğe girmesi gereken kayıtlar
  let id = 0;
  for (let g = 400; g >= 0; g--) {
    const d = new Date(bugun); d.setDate(d.getDate() - g);
    const k = dkey(d), ym = k.slice(0, 7);
    let saat = 8;
    const n = Math.floor(rnd() * 5);
    for (let i = 0; i < n; i++) {
      const t = sec(['konu', 'tekrar', 'soru']), s = sec(SUBJ);
      const mm = 20 + Math.floor(rnd() * 140), m = Math.max(1, mm - Math.floor(rnd() * 10));
      const q = t === 'soru' ? Math.floor(rnd() * Math.min(200, m * 2)) : (rnd() < 0.2 ? Math.floor(rnd() * 30) : 0);
      const c = Math.floor(rnd() * (q + 1)), w = Math.floor(rnd() * (q - c + 1));
      const st = new Date(d); st.setHours(saat, Math.floor(rnd() * 50), 0, 0);
      if (g === 0 && st.getTime() + (mm + 10) * 60000 > Date.now()) break;   // bugün: gelecekte bitmesin
      const en = st.getTime() + (mm + 5) * 60000;
      saat = new Date(en).getHours() + 1;
      if (saat > 22) break;
      const e = { d: k, s, t, m, mm, st: st.getTime(), en, b: 5, bn: 1, q, c, w, n: '', k: '', ts: st.getTime() };
      const key = 'k' + (id++);
      (kron[ym] || (kron[ym] = {}))[key] = e;
      if (rnd() < 0.05) kron[ym][key] = { del: 1, ts: Date.now() };    // silinmiş
      else gercek.push({ ...e, kind: 't' });
    }
    if (rnd() < 0.15 && g < 360) {
      const t = sec(['konu', 'tekrar', 'soru']), s = sec(SUBJ), m = 10 + Math.floor(rnd() * 90);
      const q = t === 'soru' ? Math.floor(rnd() * 80) : 0, c = Math.floor(rnd() * (q + 1)), w = Math.floor(rnd() * (q - c + 1));
      const key = 'm' + (id++);
      (manual[ym] || (manual[ym] = {}))[key] = { d: k, s, t, m, q, c, w, n: '', k: '', ts: Date.now() };
      gercek.push({ d: k, s, t, m, q, c, w, kind: 'm' });
    }
  }

  // --- Bağımsız hesap ---
  const pzt = new Date(bugun); pzt.setDate(pzt.getDate() - ((pzt.getDay() + 6) % 7));
  const ayBas = geri => dkey(new Date(bugun.getFullYear(), bugun.getMonth() - geri, 1));
  const tk = dkey(bugun), ym0 = tk.slice(0, 7);
  const DONEM = {
    hafta: e => e.d >= dkey(pzt), ay: e => e.d.startsWith(ym0), '3ay': e => e.d >= ayBas(2), '12ay': e => e.d >= ayBas(11), tumu: () => true,
  };
  const ornekAy = dkey(new Date(bugun.getFullYear(), bugun.getMonth() - 5, 1)).slice(0, 7);
  DONEM['m:' + ornekAy] = e => e.d.startsWith(ornekAy);
  const hesap = liste => {
    const a = { dk: 0, konu: 0, tekrar: 0, soruDk: 0, q: 0, c: 0, gun: new Set(), konuN: 0, tekrarN: 0 };
    for (const e of liste) { a.dk += e.m; a.q += e.q; a.c += e.c; a.gun.add(e.d); if (e.t === 'konu') { a.konu += e.m; a.konuN++; } else if (e.t === 'tekrar') { a.tekrar += e.m; a.tekrarN++; } else a.soruDk += e.m; }
    return a;
  };
  const dkMetin = t => { t = String(t).replace(/\./g, ''); let m = 0; const h = /(\d+)\s*sa/.exec(t), d = /(\d+)\s*dk/.exec(t); if (h) m += +h[1] * 60; if (d) m += +d[1]; return m; };
  const sayi = t => Number(String(t).replace(/\./g, '').replace(/[^\d]/g, '') || 0);

  // --- Uygulamayı bu veriyle aç (yerel kip) ---
  const p = await b.newPage({ viewport: { width: 1280, height: 900 } });
  const hatalar = []; p.on('pageerror', e => hatalar.push(e.message));
  await p.addInitScript(() => { try { Object.defineProperty(window, 'TUSDOSTUM_AYAR', { get: () => ({}), set: () => {}, configurable: false }); } catch {} });
  await p.goto(F);
  await p.evaluate(([k, v]) => { localStorage.clear(); localStorage.setItem(k, JSON.stringify(v)); localStorage.setItem('tusdostum.pref', JSON.stringify({ welcomed: true, period: 'tumu', incManual: false })); }, ['tusdostum.v3', { root: { nick: 'İst' }, kron, manual, settings: {}, denemeler: {} }]);
  await p.reload(); await p.waitForTimeout(800);
  await p.evaluate(() => { location.hash = 'dersler'; }); await p.waitForTimeout(500);

  let hataSay = 0, denetim = 0; const ilkHatalar = [];
  for (const elleDahil of [false, true]) {
    const cb = await p.$('#incManual');
    if ((await cb.isChecked()) !== elleDahil) { await cb.click(); await p.waitForTimeout(300); }
    for (const [donem, f] of Object.entries(DONEM)) {
      if (donem.startsWith('m:')) { await p.selectOption('#periodMonth', donem); }
      else await p.click(`[data-period="${donem}"]`);
      await p.waitForTimeout(250);
      const ekran = await p.evaluate(() => {
        const tiles = [...document.querySelectorAll('#panel-dersler .tile')].map(t => ({ v: t.querySelector('.v').textContent, s: t.querySelector('.s').textContent }));
        const rows = [...document.querySelectorAll('#panel-dersler table.tbl tbody tr')].map(tr => ({ s: tr.dataset.subj, td: [...tr.querySelectorAll('td')].map(x => x.textContent.trim()) }));
        const foot = [...document.querySelectorAll('#panel-dersler table.tbl tfoot td')].map(x => x.textContent.trim());
        return { tiles, rows, foot };
      });
      const liste = gercek.filter(e => f(e) && (elleDahil || e.kind === 't'));
      const T = hesap(liste);
      const kontrol = (ad, ekr, bek) => { denetim++; if (ekr !== bek) { hataSay++; if (ilkHatalar.length < 8) ilkHatalar.push(`${donem}${elleDahil ? '+elle' : ''} ${ad}: ekran ${ekr} ≠ ${bek}`); } };
      kontrol('toplam dk', dkMetin(ekran.tiles[0].v), T.dk);
      kontrol('aktif gün', sayi(ekran.tiles[0].s), T.gun.size);
      kontrol('konu dk', dkMetin(ekran.tiles[1].v), T.konu);
      kontrol('konu oturum', sayi(ekran.tiles[1].s), T.konuN);
      kontrol('tekrar dk', dkMetin(ekran.tiles[2].v), T.tekrar);
      kontrol('soru sayısı', sayi(ekran.tiles[3].v), T.q);
      if (T.q) kontrol('doğru %', sayi(ekran.tiles[3].s), Math.round(T.c / T.q * 100));
      kontrol('tablo toplam dk', dkMetin(ekran.foot[6]), T.dk);
      for (const r of ekran.rows) {
        const S = hesap(liste.filter(e => e.s === r.s));
        kontrol(`${r.s} konu`, dkMetin(r.td[1]), S.konu);
        kontrol(`${r.s} tekrar`, dkMetin(r.td[2]), S.tekrar);
        kontrol(`${r.s} soru dk`, dkMetin(r.td[3]), S.soruDk);
        kontrol(`${r.s} soru`, sayi(r.td[4]), S.q);
        if (S.q) kontrol(`${r.s} doğru %`, sayi(r.td[5]), Math.round(S.c / S.q * 100));
        kontrol(`${r.s} toplam`, dkMetin(r.td[6]), S.dk);
      }
    }
  }
  ok(`Dersler ekranındaki ${denetim} sayının hepsi bağımsız hesapla aynı (6 dönem × elle dahil/hariç × 12 ders)`, hataSay === 0 && denetim > 500, ilkHatalar.join(' | '));
  ok(`Veri: ${gercek.length} geçerli kayıt (${gercek.filter(e => e.kind === 'm').length} elle), silinmişler sayılmadı`, gercek.length > 300);

  // Kayıtlar ekranı: her ayın kayıt sayısı
  await p.evaluate(() => { location.hash = 'kayitlar'; }); await p.waitForTimeout(400);
  let ayHata = 0; const aylar = [...new Set(gercek.map(e => e.d.slice(0, 7)))].sort().reverse().slice(0, 4);
  for (const ym of aylar) {
    const n = await p.evaluate(() => document.querySelectorAll('#logPanel .entry').length);
    const bek = gercek.filter(e => e.d.startsWith(ym)).length;
    if (n !== bek) { ayHata++; ilkHatalar.push(`${ym}: ekran ${n} ≠ ${bek}`); }
    const geri = await p.$('[data-mnav="older"]'); if (geri) { await geri.click(); await p.waitForTimeout(250); }
  }
  ok('Kayıtlar ekranında son 4 ayın kayıt sayıları doğru (silinmişler yok)', ayHata === 0, ilkHatalar.slice(-4).join(' | '));
  ok('Sayfa hatası yok', !hatalar.length, hatalar.join(' | '));
  console.log(out.join('\n'));
  await b.close();
})();
