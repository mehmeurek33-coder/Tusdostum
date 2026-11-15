// Ad seçmeden uygulamaya geçilemez; ad seçmemiş kişi başkalarının listesinde görünmez.
// Çalıştırma: NODE_PATH="$(npm root -g):<pg'nin olduğu node_modules>" [GERCEK=1] node test/ad-zorunlu.js
const { chromium } = require('playwright');
const { baslat } = require('./sahte-supabase.js');
const out = [];
const ok = (ad, kosul, ek = '') => out.push(`${kosul ? 'GEÇTİ ' : 'KALDI '} ${ad}${!kosul && ek ? ' — ' + ek : ''}`);
const bekle = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const S = await baslat(0, { gercek: process.env.GERCEK === '1' });
  const b = await chromium.launch(); const hatalar = [];
  const kisi = async () => { const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, serviceWorkers: 'block' }); const p = await ctx.newPage(); p.on('pageerror', e => hatalar.push(e.message)); await p.goto(S.adres + '/'); return p; };
  const kayit = async (p, mail) => { await p.waitForSelector('#authView'); await p.click('#authView [data-mode="kayit"]'); await p.fill('#aMail', mail); await p.fill('#aPass', 'gizli123'); await p.click('#aGo'); await p.waitForSelector('#joinForm', { timeout: 15000 }); };
  try {
    // B: adını seçen, odada bakan kişi
    const B = await kisi(); await kayit(B, 'b@t.dev'); await B.fill('#jNick', 'Burak'); await B.click('#joinForm button[type=submit]'); await bekle(900);
    // A: yeni kayıt, ad seçmiyor
    const A = await kisi(); await kayit(A, 'a@t.dev');
    const pencere = await A.evaluate(() => ({ kapat: document.querySelectorAll('#joinForm [data-close-modal]').length, baslik: document.querySelector('#joinForm h2').textContent }));
    ok('Kayıttan sonra ad penceresinde "Şimdi değil" ve kapat (×) düğmesi yok', pencere.kapat === 0, JSON.stringify(pencere));
    await A.mouse.click(195, 30); await bekle(300);                       // arka plana dokun
    ok('Arka plana dokunmak pencereyi kapatmıyor', !!(await A.$('#joinForm')));
    await A.click('#joinForm button[type=submit]'); await bekle(300);
    ok('Boş adla "Başla" olmuyor, uyarı çıkıyor', !!(await A.$('#joinForm')) && /bir ad yaz/i.test(await A.textContent('#jErr')), await A.textContent('#jErr'));
    await A.fill('#jNick', ' a '); await A.click('#joinForm button[type=submit]'); await bekle(300);
    ok('Tek harfli ad kabul edilmiyor', !!(await A.$('#joinForm')));
    await bekle(1500);
    await B.evaluate(() => { location.hash = 'salon'; }); await bekle(1200);
    const listeB = (await B.textContent('#onlinePanel')).replace(/\s+/g, ' ');
    const uidA = S.hesaplar.get('a@t.dev').id;
    ok('Ad seçmeyen kişi başkasının listesinde görünmüyor ("Bir çalışma arkadaşı" yok)', !/Bir çalışma arkadaşı/.test(listeB) && !(await B.$(`#onlinePanel [data-profile="${uidA}"]`)), listeB.slice(0, 200));
    // Yeniden açınca pencere yine gelir
    await A.reload(); await A.waitForSelector('#joinForm', { timeout: 15000 });
    ok('Uygulamayı yeniden açınca ad penceresi yine geliyor', !!(await A.$('#joinForm')) && (await A.$$('#joinForm [data-close-modal]')).length === 0);
    // Adını seçince görünür
    await A.fill('#jNick', 'Ayşe'); await A.click('#joinForm button[type=submit]'); await bekle(1200);
    ok('Ad yazınca pencere kapanıyor', !(await A.$('#joinForm')));
    let gorundu = false;
    for (let i = 0; i < 20 && !gorundu; i++) { await bekle(400); gorundu = /Ayşe/.test(await B.textContent('#onlinePanel')); }
    ok('Ad seçince başkasının listesinde adıyla görünüyor', gorundu);
    await A.reload(); await bekle(2500);
    ok('Adı olan kişiye pencere bir daha çıkmıyor', !(await A.$('#joinForm')));
    ok('Sayfa hatası yok', !hatalar.length, hatalar.join(' | '));
  } catch (e) { ok('Test akışı tamamlandı', false, e.stack || e.message); }
  await b.close(); await S.kapat();
  console.log(out.join('\n'));
  console.log(`\n${out.filter(x => x.startsWith('GEÇTİ')).length} geçti, ${out.filter(x => x.startsWith('KALDI')).length} kaldı`);
})();
