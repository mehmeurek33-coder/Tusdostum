// Kayıt güvenliği: bağlantı koparken kayıt, uygulamayı kapatıp açma, iki cihazın aynı anda yeni aya yazması,
// çevrimdışı başlatılan kronometre. Gerçek PostgreSQL + satır güvenliği ile.
// Çalıştırma: NODE_PATH="$(npm root -g):<pg'nin olduğu node_modules>" [GERCEK=1] node test/kayit-guvenligi.js
const { chromium } = require('playwright');
const { baslat } = require('./sahte-supabase.js');
const out = [];
const ok = (ad, kosul, ek = '') => out.push(`${kosul ? 'GEÇTİ ' : 'KALDI '} ${ad}${!kosul && ek ? ' — ' + ek : ''}`);
const bekle = ms => new Promise(r => setTimeout(r, ms));
const pad = n => String(n).padStart(2, '0');
const gun = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

(async () => {
  const GERCEK = process.env.GERCEK === '1';
  const S = await baslat(0, { gercek: GERCEK });
  console.log(GERCEK ? 'İstemci: GERÇEK supabase-js' : 'İstemci: sahte istemci');
  const b = await chromium.launch();
  const hatalar = [];
  const ctxA = await b.newContext({ viewport: { width: 390, height: 780 }, hasTouch: true, serviceWorkers: 'block' });
  const sayfa = async ctx => { const p = await ctx.newPage(); p.on('pageerror', e => hatalar.push(e.message)); await p.goto(S.adres + '/'); return p; };
  const elle = async (p, dk, tarih) => {
    await p.evaluate(() => { location.hash = 'bugun'; }); await bekle(250);
    await p.click('[data-act="manual"]'); await p.waitForSelector('#entryForm');
    if (tarih) await p.fill('#fD', tarih);
    await p.fill('#fM', String(dk)); await p.click('#entryForm button[type=submit]'); await bekle(300);
  };
  const sunucudakiDk = async (mail) => {
    const uid = S.hesaplar.get(mail).id;
    const r = await S.sql(`select e.value->>'m' as m from ozel_belgeler o, jsonb_each(o.veri->'entries') e where o.uid = $1 and o.belge like 'elle-%' and not (e.value ? 'del')`, [uid]);
    return r.map(x => +x.m).sort((a, c) => a - c);
  };
  const kayitlarDk = p => p.evaluate(() => { location.hash = 'kayitlar'; return new Promise(r => setTimeout(() => r(document.querySelector('#logPanel').textContent.replace(/\s+/g, ' ')), 400)); });
  try {
    let A = await sayfa(ctxA);
    await A.waitForSelector('#authView');
    await A.click('#authView [data-mode="kayit"]'); await A.fill('#aMail', 'k@test.dev'); await A.fill('#aPass', 'gizli123'); await A.click('#aGo');
    await A.waitForSelector('#joinForm', { timeout: 15000 }); await A.fill('#jNick', 'Kayıt'); await A.click('#joinForm button[type=submit]'); await bekle(600);

    // 1) Normal kayıt
    await elle(A, 31); await bekle(800);
    ok('Normal kayıt sunucuya yazıldı', JSON.stringify(await sunucudakiDk('k@test.dev')) === '[31]');

    // 2) Bağlantı koparken kayıt: telefonda bekler, ekranda görünür, uyarı çıkar
    await ctxA.setOffline(true);
    await elle(A, 32); await bekle(2500);
    const afis = (await A.textContent('#banner')).replace(/\s+/g, ' ');
    ok('Bağlantı yokken: "kayıt telefonda bekliyor" uyarısı', /1 kayıt telefonda bekliyor/.test(afis), afis);
    ok('Bağlantı yokken: kayıt ekranda görünüyor', /32 dk/.test(await kayitlarDk(A)));
    ok('Bağlantı yokken: "Kaydedilemedi" hatası çıkmadı', !hatalar.length && !/Kaydedilemedi/.test(await A.textContent('#toast').catch(() => '')));
    ok('Bağlantı yokken: sunucuda henüz yok', JSON.stringify(await sunucudakiDk('k@test.dev')) === '[31]');

    // 3) Bağlantı gelince kendiliğinden gönderilir
    await ctxA.setOffline(false);
    await A.evaluate(() => window.dispatchEvent(new Event('online')));
    for (let i = 0; i < 30 && JSON.stringify(await sunucudakiDk('k@test.dev')) !== '[31,32]'; i++) await bekle(300);
    ok('Bağlantı gelince bekleyen kayıt kaydedildi', JSON.stringify(await sunucudakiDk('k@test.dev')) === '[31,32]');
    await bekle(300);
    ok('Bağlantı gelince uyarı kalktı', !/telefonda bekliyor/.test(await A.textContent('#banner')));

    // 4) Bağlantı yokken kayıt + uygulamayı kapat; sonra bağlantıyla aç → kayıt gider
    await ctxA.setOffline(true);
    await elle(A, 33); await bekle(1200);
    await A.close();
    await ctxA.setOffline(false);
    ok('Uygulama kapanınca kayıt henüz sunucuda değil', JSON.stringify(await sunucudakiDk('k@test.dev')) === '[31,32]');
    A = await sayfa(ctxA);
    for (let i = 0; i < 40 && JSON.stringify(await sunucudakiDk('k@test.dev')) !== '[31,32,33]'; i++) await bekle(300);
    ok('Uygulama yeniden açılınca bekleyen kayıt kaydedildi', JSON.stringify(await sunucudakiDk('k@test.dev')) === '[31,32,33]', JSON.stringify(await sunucudakiDk('k@test.dev')));
    await bekle(800);
    ok('Yeniden açılışta üç kayıt da ekranda', /31 dk/.test(await kayitlarDk(A)) && /32 dk/.test(await kayitlarDk(A)) && /33 dk/.test(await kayitlarDk(A)));

    // 5) İki cihaz aynı anda, ikisi de çevrimdışıyken, henüz olmayan bir aya yazar
    const ctxB = await b.newContext({ viewport: { width: 390, height: 780 }, hasTouch: true, serviceWorkers: 'block' });
    const B = await sayfa(ctxB);
    await B.waitForSelector('#authView'); await B.fill('#aMail', 'k@test.dev'); await B.fill('#aPass', 'gizli123'); await B.click('#aGo');
    await B.waitForFunction(() => !document.querySelector('#authView'), null, { timeout: 15000 }); await bekle(1500);
    const eski = new Date(); eski.setDate(1); eski.setMonth(eski.getMonth() - 2); eski.setDate(10);
    const t = gun(eski);
    await ctxA.setOffline(true); await ctxB.setOffline(true);
    await elle(A, 41, t); await elle(B, 42, t); await bekle(800);
    await ctxA.setOffline(false); await ctxB.setOffline(false);
    await Promise.all([A.evaluate(() => window.dispatchEvent(new Event('online'))), B.evaluate(() => window.dispatchEvent(new Event('online')))]);
    const hedef = '[31,32,33,41,42]';
    for (let i = 0; i < 40 && JSON.stringify(await sunucudakiDk('k@test.dev')) !== hedef; i++) await bekle(300);
    ok('İki cihazın aynı anda yeni aya yazdığı iki kayıt da duruyor', JSON.stringify(await sunucudakiDk('k@test.dev')) === hedef, JSON.stringify(await sunucudakiDk('k@test.dev')));
    await B.reload(); await bekle(2000);
    const bk = await kayitlarDk(B);
    await B.evaluate(m => { location.hash = 'kayitlar'; }, null);
    ok('Diğer cihaz yenileyince bütün kayıtları görüyor', /31 dk/.test(bk) && /33 dk/.test(bk));

    // 6) Silme çevrimdışı: bağlantı gelince silinir, geri gelmez
    await ctxB.setOffline(true);
    await B.evaluate(() => { location.hash = 'kayitlar'; }); await bekle(400);
    const silindi = await B.evaluate(() => {
      const r = [...document.querySelectorAll('#logPanel [data-menu]')].find(x => x.closest('.entry').textContent.includes('31 dk'));
      if (!r) return false; r.click(); return true;
    });
    if (silindi) {
      await bekle(300); await B.click('[data-del]'); await bekle(200); await B.click('[data-del-yes]'); await bekle(800);
      await ctxB.setOffline(false); await B.evaluate(() => window.dispatchEvent(new Event('online')));
      for (let i = 0; i < 30 && (await sunucudakiDk('k@test.dev')).includes(31); i++) await bekle(300);
    }
    ok('Çevrimdışı silinen kayıt, bağlantı gelince sunucudan da silindi', silindi && JSON.stringify(await sunucudakiDk('k@test.dev')) === '[32,33,41,42]', JSON.stringify(await sunucudakiDk('k@test.dev')));

    // 7) Çevrimdışı başlatılan kronometre kaybolmaz
    await ctxA.setOffline(true);
    await A.evaluate(() => { location.hash = 'bugun'; }); await bekle(300);
    await A.click('[data-act="start"]'); await bekle(1500);
    await A.close(); await ctxA.setOffline(false);
    A = await sayfa(ctxA); await bekle(3000);
    ok('Çevrimdışı başlatılan kronometre, uygulama yeniden açılınca sürüyor', await A.evaluate(() => /Çalışıyor/.test(document.querySelector('#timerCard').textContent)));
    const kr = await S.sql(`select veri->'timer'->>'runStart' as rs from ozel_belgeler where uid = $1 and belge = 'kronometre'`, [S.hesaplar.get('k@test.dev').id]);
    ok('Kronometre sunucuya da yazıldı', kr.length === 1 && !!kr[0].rs);
    ok('Kuyrukta bekleyen yazma kalmadı', await A.evaluate(() => window.TusAltyapi.giden.sayi() === 0));
    ok('Sayfa hatası yok', hatalar.length === 0, hatalar.join(' | '));
  } catch (e) { ok('Test akışı tamamlandı', false, (e && e.stack) || String(e)); }
  console.log(out.join('\n'));
  console.log(`\n${out.filter(x => x.startsWith('GEÇTİ')).length} geçti, ${out.filter(x => x.startsWith('KALDI')).length} kaldı`);
  await b.close(); await S.kapat();
})();
