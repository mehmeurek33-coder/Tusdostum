// Yeni ekranların önizleme görüntüleri (github/onizleme/) + 320 px taşma denetimi.
const { chromium } = require('playwright');
const path = require('path');
const { baslat } = require('./sahte-supabase.js');
const OUT = path.resolve(__dirname, '../onizleme');
const bekle = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  const S = await baslat(0);
  const b = await chromium.launch();
  const denet = async (p, ad) => console.log(ad, JSON.stringify(await p.evaluate(() => ({
    tasma: document.documentElement.scrollWidth - innerWidth,
    kucuk: [...document.querySelectorAll('#authView button, #alForm button, #timerCard .bell')].filter(e => e.offsetParent && (e.getBoundingClientRect().height < 44 || e.getBoundingClientRect().width < 44)).map(e => (e.textContent || e.className).trim() + ' ' + Math.round(e.getBoundingClientRect().width) + 'x' + Math.round(e.getBoundingClientRect().height)),
  }))));
  for (const [w, tema] of [[390, 'dark'], [320, 'light']]) {
    const ctx = await b.newContext({ viewport: { width: w, height: 760 }, deviceScaleFactor: 2, colorScheme: tema, hasTouch: true, serviceWorkers: 'block' });
    const p = await ctx.newPage();
    const hata = []; p.on('pageerror', e => hata.push(e.message));
    await p.goto(S.adres + '/');
    await p.waitForSelector('#authView'); await bekle(600);
    await denet(p, `giris@${w}`);
    if (w === 390) await p.screenshot({ path: path.join(OUT, '1-giris-ekrani.png') });
    await p.click('#authView [data-mode="kayit"]'); await p.fill('#aMail', `kisi${w}@test.dev`); await p.fill('#aPass', 'gizli123'); await p.click('#aGo');
    await p.waitForSelector('#joinForm', { timeout: 15000 }); await p.fill('#jNick', 'Mehmet'); await p.click('#joinForm button[type=submit]'); await bekle(600);
    await p.click('#timerCard .bell'); await p.waitForSelector('#alForm');
    await p.click('[data-chips="breakWarn"] button[data-v="10"]'); await p.click('[data-chips="workWarn"] button[data-v="45"]'); await bekle(300);
    await denet(p, `uyarilar@${w}`);
    if (w === 390) await p.screenshot({ path: path.join(OUT, '3-uyarilar-penceresi.png') });
    await p.click('#alForm [data-close-modal]');
    await p.click('[data-act="start"]'); await bekle(500);
    await denet(p, `kart@${w}`);
    if (w === 390) await p.screenshot({ path: path.join(OUT, '2-kronometre-zil.png'), clip: { x: 0, y: 0, width: 390, height: 560 } });
    console.log('sayfa hatası', hata.length, hata.join(' | '));
    await ctx.close();
  }
  await b.close(); await S.kapat();
})();
