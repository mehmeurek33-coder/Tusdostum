// Çalıştırma: NODE_PATH="$(npm root -g):<pg'nin olduğu node_modules>" node test/gecmis.js
// Sekmeler arasında dolaşınca tarayıcı geçmişi büyümüyor mu (iPhone'un soldan "geri" hareketi bir şeye götürmesin)
const { chromium } = require('playwright');
const { baslat } = require('./sahte-supabase.js');
(async () => {
  const S = await baslat(0, {}); const b = await chromium.launch(); const out = [];
  const ok = (a, k, e = '') => out.push(`${k ? 'GEÇTİ ' : 'KALDI '} ${a}${!k && e ? ' — ' + e : ''}`);
  const bekle = ms => new Promise(r => setTimeout(r, ms));
  try {
    const ctx = await b.newContext({ viewport: { width: 390, height: 780 }, hasTouch: true, serviceWorkers: 'block' });
    const p = await ctx.newPage(); const hata = []; p.on('pageerror', e => hata.push(e.message));
    await p.goto(S.adres + '/'); await p.waitForSelector('#authView');
    await p.click('#authView [data-mode="kayit"]'); await p.fill('#aMail', 'g@test.dev'); await p.fill('#aPass', 'gizli123'); await p.click('#aGo');
    await p.waitForSelector('#joinForm', { timeout: 15000 }); await p.fill('#jNick', 'Gez'); await p.click('#joinForm button[type=submit]'); await bekle(1200);
    const bas = await p.evaluate(() => history.length);
    for (const t of ['salon', 'dersler', 'denemeler', 'kayitlar', 'bugun', 'dersler']) { await p.click(`.tab[data-tab="${t}"]`); await bekle(250); }
    const sekme = await p.evaluate(() => ({ n: history.length, h: location.hash, sec: document.querySelector('.tab[aria-selected="true"]').dataset.tab, gor: !document.querySelector('#panel-dersler').hidden }));
    ok('Alttaki sekmelere dokununca doğru sekme açılıyor', sekme.h === '#dersler' && sekme.sec === 'dersler' && sekme.gor, JSON.stringify(sekme));
    ok('Sekmeler arasında dolaşınca tarayıcı geçmişi büyümüyor (soldan "geri" hareketi hiçbir yere gitmez)', sekme.n === bas, `${bas} → ${sekme.n}`);
    await p.evaluate(() => { const b = document.querySelector('#panel-dersler [data-subj], #panel-dersler [data-open-subject], #panel-dersler button[data-s]'); if (b) b.click(); }); await bekle(300);
    const ders = await p.evaluate(() => ({ n: history.length, h: location.hash }));
    ok('Ders ayrıntısı açılınca da geçmiş büyümüyor', ders.n === bas, JSON.stringify(ders));
    ok('Sayfa hatası yok', !hata.length, hata.join(' | '));
  } catch (e) { ok('akış', false, e.message); }
  await b.close(); await S.kapat();
  console.log(out.join('\n'));
})();
