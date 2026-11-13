// Güncelleme güvenliği: yeni sürüm, kronometre çalışırken devreye GİRMEZ; durunca ve uygulama öne gelince girer.
// Uygulama dosyaları hep aynı sürümden gelir; güncellemede kayıtlar değişmez.
// Çalıştırma: NODE_PATH="$(npm root -g):<pg'nin olduğu node_modules>" node test/guncelleme.js
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path'), os = require('os');
const { execFileSync } = require('child_process');
const { baslat } = require('./sahte-supabase.js');
const out = [];
const ok = (ad, kosul, ek = '') => out.push(`${kosul ? 'GEÇTİ ' : 'KALDI '} ${ad}${!kosul && ek ? ' — ' + ek : ''}`);
const bekle = ms => new Promise(r => setTimeout(r, ms));
const KOK = path.resolve(__dirname, '..');

(async () => {
  // Uygulamanın bir kopyası sunulur; "yeni sürüm" bu kopyada bir değişiklik yapıp yeniden derleyerek üretilir
  const kopya = fs.mkdtempSync(path.join(os.tmpdir(), 'td-surum-'));
  for (const f of ['index.html', 'config.js', 'altyapi.js', 'sw.js', 'manifest.webmanifest']) fs.copyFileSync(path.join(KOK, f), path.join(kopya, f));
  for (const d of ['vendor', 'icons']) { fs.mkdirSync(path.join(kopya, d)); for (const f of fs.readdirSync(path.join(KOK, d))) fs.copyFileSync(path.join(KOK, d, f), path.join(kopya, d, f)); }
  const surumOku = f => /name="td-surum" content="([^"]+)"/.exec(fs.readFileSync(f, 'utf8'))[1];
  const v1 = surumOku(path.join(kopya, 'index.html'));
  const yeniSurumYap = () => {
    // index.html'e zararsız bir değişiklik + sürüm damgasını ve sw.js'i güncelle (yap.py'nin yaptığı gibi)
    let h = fs.readFileSync(path.join(kopya, 'index.html'), 'utf8');
    const v2 = v1.split('').reverse().join('');
    h = h.replace(`content="${v1}"`, `content="${v2}"`).replace('</body>', '<!-- yeni sürüm --></body>');
    fs.writeFileSync(path.join(kopya, 'index.html'), h);
    const sw = fs.readFileSync(path.join(kopya, 'sw.js'), 'utf8').replace(/const SURUM = "td-[^"]*";/, `const SURUM = "td-${v2}";`);
    fs.writeFileSync(path.join(kopya, 'sw.js'), sw);
    return v2;
  };

  const S = await baslat(0, { kok: kopya });
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 390, height: 780 }, hasTouch: true });
  const p = await ctx.newPage();
  const hatalar = []; p.on('pageerror', e => hatalar.push(e.message));
  let yuklemeler = 0; p.on('load', () => { yuklemeler++; });
  const surum = () => p.evaluate(() => document.querySelector('meta[name="td-surum"]').content);
  try {
    await p.goto(S.adres + '/');
    await p.waitForSelector('#authView');
    await p.click('#authView [data-mode="kayit"]'); await p.fill('#aMail', 'g@test.dev'); await p.fill('#aPass', 'gizli123'); await p.click('#aGo');
    await p.waitForSelector('#joinForm', { timeout: 15000 }); await p.fill('#jNick', 'Güncel'); await p.click('#joinForm button[type=submit]'); await bekle(600);
    await p.evaluate(async () => { await navigator.serviceWorker.ready; });
    await p.reload(); await bekle(1500);                              // artık sayfa servis çalışanının denetiminde
    ok('İlk sürüm çalışıyor ve servis çalışanı denetimde', (await surum()) === v1 && await p.evaluate(() => !!navigator.serviceWorker.controller));
    // kayıtlar: bir elle kayıt + kronometre başlat
    await p.click('[data-act="manual"]'); await p.waitForSelector('#entryForm'); await p.fill('#fM', '44'); await p.click('#entryForm button[type=submit]'); await bekle(800);
    await p.click('[data-act="start"]'); await bekle(1000);
    const uid = S.hesaplar.get('g@test.dev').id;
    const ozet = async () => (await S.sql(`select md5(string_agg(belge || ':' || veri::text, '|' order by belge)) as h from ozel_belgeler where uid = $1 and belge <> 'kronometre'`, [uid]))[0].h;
    const once = await ozet();

    // --- yeni sürüm yayınlandı ---
    const v2 = yeniSurumYap();
    const yA = yuklemeler;
    await p.evaluate(async () => { const r = await navigator.serviceWorker.getRegistration(); await r.update(); });
    for (let i = 0; i < 30 && !(await p.evaluate(async () => !!(await navigator.serviceWorker.getRegistration()).waiting)); i++) await bekle(200);
    ok('Yeni sürüm arka planda indi ve bekliyor', await p.evaluate(async () => !!(await navigator.serviceWorker.getRegistration()).waiting));
    // kronometre çalışırken: öne gelme olayı → devreye GİRMEMELİ
    await p.evaluate(() => document.dispatchEvent(new Event('visibilitychange'))); await bekle(3500);
    ok('Kronometre çalışırken yeni sürüm devreye girmedi (sayfa yenilenmedi)', yuklemeler === yA && (await surum()) === v1);
    ok('Kronometre çalışırken bile dosyalar hep eski sürümden (karışık sürüm yok)', await p.evaluate(async () => (await (await fetch('index.html')).text()).includes('<!-- yeni sürüm -->') === false));
    // kronometre durdurulur (sıfırla); sonra bir kayıt penceresi açıkken de girmemeli
    await p.click('[data-act="reset"]'); await p.click('[data-act="reset-yes"]'); await bekle(800);
    ok('Kronometre durdu', !(await p.evaluate(() => /Çalışıyor/.test(document.querySelector('#timerCard').textContent))));
    await p.click('[data-act="manual"]'); await p.waitForSelector('#entryForm'); await p.fill('#fM', '15'); await bekle(300);
    await p.evaluate(() => document.dispatchEvent(new Event('visibilitychange'))); await bekle(3500);
    ok('Kayıt penceresi açıkken de devreye girmedi (yazılan kayıt kaybolmadı)', yuklemeler === yA && (await surum()) === v1 && await p.inputValue('#fM') === '15');
    await p.click('#entryForm button[type=submit]'); await bekle(1500);
    // artık güvenli: öne gelince devreye girer
    const guncellemeOncesi = await ozet();
    await p.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    for (let i = 0; i < 40 && yuklemeler === yA; i++) await bekle(200);
    await bekle(2000);
    ok('Kimse çalışmıyorken öne gelince yeni sürüm devreye girdi', yuklemeler > yA && (await surum()) === v2);
    ok('"Uygulama güncellendi." bildirimi', /güncellendi/.test(await p.textContent('#toast').catch(() => '')));
    await bekle(1500);
    ok('Güncellemenin kendisi kayıtlara dokunmadı (öncesi ve sonrası birebir aynı)', guncellemeOncesi === await ozet());
    // Not: "once" kronometre çalışırken alındı; arada oturum kaydedildi. Güncellemenin kendisinin bir şey değiştirmediğini
    // görmek için devreye girmeden hemen önceki ve sonraki özet karşılaştırılır.
    const kayitlar = (await S.sql(`select o.belge, e.key, e.value from ozel_belgeler o, jsonb_each(o.veri->'entries') e where o.uid = $1 order by 1, 2`, [uid])).map(r => `${r.belge}/${r.key}:${r.value.m}`);
    ok('Güncelleme sonrası sunucuda iki kayıt duruyor (44 dk + 15 dk)', kayitlar.length === 2 && kayitlar.some(x => x.endsWith(':44')) && kayitlar.some(x => x.endsWith(':15')), JSON.stringify(kayitlar));
    ok('Sayfa hatası yok', hatalar.length === 0, hatalar.join(' | '));
  } catch (e) { ok('Test akışı tamamlandı', false, (e && e.stack) || String(e)); }
  console.log(out.join('\n'));
  console.log(`\n${out.filter(x => x.startsWith('GEÇTİ')).length} geçti, ${out.filter(x => x.startsWith('KALDI')).length} kaldı`);
  await b.close(); await S.kapat();
  fs.rmSync(kopya, { recursive: true, force: true });
})();
