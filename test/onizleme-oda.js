// Salon'daki "Oda kur" / "Odaya katıl" önizleme görüntüleri (../../onizleme/)
const { chromium } = require('playwright');
const path = require('path');
const { baslat } = require('./sahte-supabase.js');
const OUT = path.resolve(__dirname, '../../onizleme');
const bekle = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  const S = await baslat(0);
  const b = await chromium.launch();
  const kisi = async (mail, ad) => {
    const ctx = await b.newContext({ viewport: { width: 390, height: 760 }, deviceScaleFactor: 2, colorScheme: 'dark', hasTouch: true, serviceWorkers: 'block' });
    const p = await ctx.newPage();
    await p.goto(S.adres + '/');
    await p.waitForSelector('#authView');
    await p.click('#authView [data-mode="kayit"]'); await p.fill('#aMail', mail); await p.fill('#aPass', 'gizli123'); await p.click('#aGo');
    await p.waitForSelector('#joinForm', { timeout: 15000 }); await p.fill('#jNick', ad); await p.click('#joinForm button[type=submit]'); await bekle(600);
    await p.evaluate(() => { location.hash = 'salon'; }); await bekle(500);
    return p;
  };
  const A = await kisi('a@test.dev', 'Zeynep');
  await A.click('[data-room-new]'); await A.fill('#rName', 'Kızlar 2027'); await A.click('#roomForm button[type=submit]'); await bekle(900);
  const B = await kisi('b@test.dev', 'Mehmet');
  await B.screenshot({ path: path.join(OUT, '4-salon-oda-dugmeleri.png'), clip: { x: 0, y: 0, width: 390, height: 430 } });
  await B.click('[data-room-join]'); await B.fill('#rName', 'Uydurma oda'); await B.click('#roomForm button[type=submit]'); await bekle(700);
  await B.screenshot({ path: path.join(OUT, '5-odaya-katil-olmayan-oda.png') });
  await B.fill('#rName', 'kızlar 2027'); await B.click('#roomForm button[type=submit]'); await bekle(3200);
  await B.screenshot({ path: path.join(OUT, '6-odaya-katildi.png'), clip: { x: 0, y: 0, width: 390, height: 520 } });
  await b.close(); await S.kapat();
})();
