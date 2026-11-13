// Kronometre saniye senkronu: büyük sayaç ile "Son oturum" aynı anda değişmeli, saniyeler eşit aralıkla ilerlemeli.
// Çalıştırma: NODE_PATH=$(npm root -g) node test/saniye.js
const { chromium } = require('playwright');
const path = require('path');
const F = 'file://' + path.resolve(__dirname, '../index.html');
const out = [];
const ok = (ad, kosul, ek = '') => out.push(`${kosul ? 'GEÇTİ ' : 'KALDI '} ${ad}${!kosul && ek ? ' — ' + ek : ''}`);

(async () => {
  const b = await chromium.launch();
  const olc = async (vp, secici) => {
    const ctx = await b.newContext({ viewport: vp });
    await ctx.addInitScript(() => { Object.defineProperty(window, 'TUSDOSTUM_AYAR', { get: () => ({}), set: () => {}, configurable: false }); });   // yerel mod
    const p = await ctx.newPage();
    const hatalar = []; p.on('pageerror', e => hatalar.push(e.message));
    await p.goto(F);
    const now = Date.now();
    // önceki oturumlardan 29,4 sn (küsuratlı), şu anki oturum 20,6 sn önce başladı
    await p.evaluate(([k, v]) => { localStorage.clear(); localStorage.setItem(k, JSON.stringify(v)); }, ['tusdostum.v3', {
      root: { nick: 'Deneme', timer: { s: 'anatomi', t: 'tekrar', st: now - 120000, runStart: now - 20600, workMs: 29400, breakStart: null, breakMs: 60000, bn: 1 } },
      kron: {}, manual: {}, settings: {}, denemeler: {} }]);
    await p.reload(); await p.waitForTimeout(800);
    const r = await p.evaluate(sec => new Promise(res => {
      const kayit = []; let onceki = '';
      const t0 = performance.now();
      const bak = () => {
        const v = sec.map(s => (document.querySelector(s) || {}).textContent || '').join(' | ');
        if (v !== onceki) { kayit.push({ t: performance.now() - t0, v }); onceki = v; }
        if (performance.now() - t0 < 6200) setTimeout(bak, 5); else res(kayit);
      };
      bak();
    }), secici);
    await p.close();
    return { r, hatalar };
  };
  // Dikey: kart sayacı + "Son oturum"
  const dik = await olc({ width: 390, height: 780 }, ['#clock', '#clockSeg']);
  const d = dik.r.slice(1);                                           // ilk kayıt başlangıç değeri
  const araliklar = d.slice(1).map((x, i) => Math.round(x.t - d[i].t));
  const sn = s => { const m = /(\d\d):(\d\d):(\d\d)[^|]*\|[^\d]*(\d\d):(\d\d):(\d\d)/.exec(s); return m ? [(+m[1]) * 3600 + (+m[2]) * 60 + (+m[3]), (+m[4]) * 3600 + (+m[5]) * 60 + (+m[6])] : null; };
  const ikili = dik.r.map(x => sn(x.v)).filter(Boolean);
  const birlikte = ikili.slice(1).every((x, i) => x[0] - ikili[i][0] === 1 && x[1] - ikili[i][1] === 1);
  ok('Büyük sayaç ile "Son oturum" her seferinde AYNI ANDA birer saniye ilerliyor', birlikte && ikili.length >= 6, JSON.stringify(dik.r.slice(0, 8)));
  ok('Saniyeler eşit aralıkla ilerliyor (her biri 1000 ± 40 ms)', araliklar.length >= 4 && araliklar.every(a => Math.abs(a - 1000) <= 40), JSON.stringify(araliklar));
  ok('Gösterilen değerler doğru (çalışma = önceki 29 sn + son oturum)', ikili.every(([w, s]) => w === 29 + s), JSON.stringify(ikili.slice(0, 3)));
  // Yatay odak görünümü
  const yat = await olc({ width: 844, height: 390 }, ['#focusClock', '#focusSub']);
  const ikili2 = yat.r.map(x => sn(x.v)).filter(Boolean);
  const ar2 = yat.r.slice(2).map((x, i) => Math.round(x.t - yat.r[i + 1].t));
  ok('Yan ekranda da iki sayaç aynı anda ve eşit aralıkla ilerliyor', ikili2.length >= 6 && ikili2.slice(1).every((x, i) => x[0] - ikili2[i][0] === 1 && x[1] - ikili2[i][1] === 1) && ar2.every(a => Math.abs(a - 1000) <= 40), JSON.stringify(ar2));
  ok('Sayfa hatası yok', !dik.hatalar.length && !yat.hatalar.length, [...dik.hatalar, ...yat.hatalar].join(' | '));
  console.log(out.join('\n'));
  await b.close();
})();
