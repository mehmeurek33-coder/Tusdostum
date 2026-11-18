// Uygulama açıkken uyarı: mola süresi aşılınca ilk uyarı, sonra 5 dakikada bir; çalışma uyarısı yalnızca bir kez (saat ileri sarılarak denenir).
// Çalıştırma: NODE_PATH=$(npm root -g) node test/uyari-tekrar.js
const { chromium } = require('playwright');
const path = require('path');
const F = 'file://' + path.resolve(__dirname, '../index.html');
const out = [];
const ok = (ad, kosul, ek = '') => out.push(`${kosul ? 'GEÇTİ ' : 'KALDI '} ${ad}${!kosul && ek ? ' — ' + ek : ''}`);

(async () => {
  const b = await chromium.launch();
  const dene = async (ayar, timer) => {
    const ctx = await b.newContext({ viewport: { width: 390, height: 780 } });
    await ctx.addInitScript(() => { Object.defineProperty(window, 'TUSDOSTUM_AYAR', { get: () => ({}), set: () => {}, configurable: false }); });
    const p = await ctx.newPage();
    const hatalar = []; p.on('pageerror', e => hatalar.push(e.message));
    await p.clock.install({ time: new Date('2026-11-13T10:00:00') });
    await p.goto(F);
    const now = await p.evaluate(() => Date.now());
    await p.evaluate(([k, v]) => { localStorage.clear(); localStorage.setItem(k, JSON.stringify(v)); localStorage.setItem('tusdostum.pref', JSON.stringify({ welcomed: true })); }, ['tusdostum.v3', {
      root: { nick: 'U', timer: timer(now) }, kron: {}, manual: {}, settings: ayar, denemeler: {} }]);
    await p.reload();
    await p.clock.runFor(2000);
    const toastlar = [];
    await p.exposeFunction('__toast', t => toastlar.push(t));
    await p.evaluate(() => new MutationObserver(() => { const t = document.querySelector('#toast'); if (t && !t.hidden) window.__toast(t.textContent); }).observe(document.querySelector('#toast'), { childList: true, characterData: true, subtree: true, attributes: true }));
    const ilk = await p.evaluate(() => document.querySelector('#toast').hidden ? '' : document.querySelector('#toast').textContent);
    if (ilk) toastlar.push(ilk);
    for (let i = 0; i < 4; i++) await p.clock.runFor(150000);       // 10 dakika ileri (2,5 dk'lık adımlar)
    await p.waitForTimeout(200);
    await ctx.close();
    return { toastlar: [...new Set(toastlar)], hatalar };
  };
  // Mola: 5 dk uyarısı, mola 7 dk önce başladı → ilk uyarı "5", sonra 10. ve 15. dakikada
  const m = await dene({ breakWarn: 5 }, now => ({ s: 'anatomi', t: 'konu', st: now - 3600e3, runStart: null, workMs: 30 * 60000, breakStart: now - 7 * 60000, breakMs: 0, bn: 1 }));
  ok('Mola: yalnızca 2 uyarı (5 → 10), sonra susuyor', JSON.stringify(m.toastlar) === JSON.stringify(['Molan 5 dakikayı geçti.', 'Molan 10 dakikayı geçti.']), JSON.stringify(m.toastlar));
  // Çalışma: 60 dk uyarısı, son oturum 61 dk → 10 dakika boyunca yalnızca bir kez
  const c = await dene({ workWarn: 60 }, now => ({ s: 'anatomi', t: 'konu', st: now - 3600e3 * 2, runStart: now - 61 * 60000, workMs: 0, breakStart: null, breakMs: 0, bn: 0 }));
  ok('Çalışma: süre aşılınca yalnızca BİR kez uyarı (tekrar yok)', JSON.stringify(c.toastlar) === JSON.stringify(['Aralıksız çalışman 60 dakikayı geçti.']), JSON.stringify(c.toastlar));
  // Son oturum sayılır: molalardan önceki 2 saat sayılmaz; son oturum 45 dk → uyarı yok
  const c2 = await dene({ workWarn: 60 }, now => ({ s: 'anatomi', t: 'konu', st: now - 4 * 3600e3, runStart: now - 45 * 60000, workMs: 120 * 60000, breakStart: null, breakMs: 20 * 60000, bn: 2 }));
  ok('Çalışma: yalnızca son oturum (son moladan beri) sayılır; seçilen süreyi aşmadıkça uyarı yok', c2.toastlar.length === 0, JSON.stringify(c2.toastlar));
  // 30 dk seçilmiş: son oturum 31 dk → bir kez uyarı
  const c3 = await dene({ workWarn: 30 }, now => ({ s: 'anatomi', t: 'konu', st: now - 3600e3, runStart: now - 31 * 60000, workMs: 0, breakStart: null, breakMs: 0, bn: 0 }));
  ok('Çalışma: 30 dk seçilince 30 dakikada bir kez uyarı', JSON.stringify(c3.toastlar) === JSON.stringify(['Aralıksız çalışman 30 dakikayı geçti.']), JSON.stringify(c3.toastlar));
  // Hedef kapalıyken de seçilen mola uyarıları çalışır
  const hk = await dene({ workWarn: 30, hedefKapali: true }, now => ({ s: 'anatomi', t: 'konu', st: now - 3600e3, runStart: now - 31 * 60000, workMs: 0, breakStart: null, breakMs: 0, bn: 0 }));
  ok('Hedef kapalıyken de "kaç dakikada bir mola" uyarısı geliyor', JSON.stringify(hk.toastlar) === JSON.stringify(['Aralıksız çalışman 30 dakikayı geçti.']), JSON.stringify(hk.toastlar));
  const hm = await dene({ breakWarn: 10, hedefKapali: true }, now => ({ s: 'anatomi', t: 'konu', st: now - 3600e3, runStart: null, workMs: 30 * 60000, breakStart: now - 11 * 60000, breakMs: 0, bn: 1 }));
  ok('Hedef kapalıyken de "mola bitti" uyarısı geliyor', hm.toastlar[0] === 'Molan 10 dakikayı geçti.', JSON.stringify(hm.toastlar));
  // Sınır: mola 3 saati aşınca tekrar yok
  const s = await dene({ breakWarn: 5 }, now => ({ s: 'anatomi', t: 'konu', st: now - 9 * 3600e3, runStart: null, workMs: 30 * 60000, breakStart: now - (5 * 60 + 3 * 3600) * 1000 - 60000, breakMs: 0, bn: 1 }));
  ok('Mola 3 saati aşınca uyarı tekrarı duruyor', s.toastlar.length === 0, JSON.stringify(s.toastlar));
  const H = [...m.hatalar, ...c.hatalar, ...c2.hatalar, ...c3.hatalar, ...hk.hatalar, ...hm.hatalar, ...s.hatalar];
  ok('Sayfa hatası yok', !H.length, H.join(' | '));
  console.log(out.join('\n'));
  await b.close();
})();
