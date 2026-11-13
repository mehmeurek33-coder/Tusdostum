// Uçtan uca test: gerçek PostgreSQL + satır düzeyi güvenlik + sahte Supabase istemcisi + gerçek tarayıcı.
// Çalıştırma (yerel PostgreSQL 'postgres' kullanıcısının şifresi PGPASSWORD ile verilir, varsayılan "test"):
//   NODE_PATH="$(npm root -g):<pg modülünün olduğu node_modules>" node test/uctan-uca.js
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path'), os = require('os');
const { baslat } = require('./sahte-supabase.js');

const out = [];
const ok = (ad, kosul, ek = '') => { out.push(`${kosul ? 'GEÇTİ ' : 'KALDI '} ${ad}${!kosul && ek ? ' — ' + ek : ''}`); };
const bekle = ms => new Promise(r => setTimeout(r, ms));
const pad = n => String(n).padStart(2, '0');
const gun = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

(async () => {
  const GERCEK = process.env.GERCEK === '1';                       // 1 → gerçek supabase-js kütüphanesi + protokol taklidi
  const S = await baslat(0, { gercek: GERCEK });
  console.log(GERCEK ? 'İstemci: GERÇEK supabase-js' : 'İstemci: sahte (hızlı) istemci');
  const b = await chromium.launch();
  const hatalar = [];
  const kisi = async (hash = '') => {
    const ctx = await b.newContext({ viewport: { width: 390, height: 780 }, hasTouch: true, serviceWorkers: 'block' });
    const p = await ctx.newPage();
    p.on('pageerror', e => hatalar.push(e.message));
    await p.goto(S.adres + '/' + hash);
    return p;
  };
  const kayit = async (p, mail, sifre = 'gizli123') => {
    await p.waitForSelector('#authView');
    await p.click('#authView [data-mode="kayit"]');
    await p.fill('#aMail', mail); await p.fill('#aPass', sifre);
    await p.click('#aGo');
  };
  const giris = async (p, mail, sifre = 'gizli123') => {
    await p.waitForSelector('#authView');
    await p.fill('#aMail', mail); await p.fill('#aPass', sifre);
    await p.click('#aGo');
  };
  const uidOf = mail => S.hesaplar.get(mail).id;
  const kok = async mail => (await S.sql('select veri from profiller where uid = $1', [uidOf(mail)]))[0];
  const uyarilar = async mail => (await S.sql('select tur, dk, zaman from uyarilar where uid = $1 order by tur', [uidOf(mail)]));

  try {
    // ---------- 1. Kayıt ve ilk giriş ----------
    const A = await kisi();
    await A.waitForSelector('#authView');
    ok('Giriş yapmadan uygulama açılmıyor, giriş ekranı geliyor', await A.isVisible('#authView') && !(await S.sql('select 1 from profiller')).length);
    await A.fill('#aMail', 'ayse@test.dev'); await A.fill('#aPass', '123'); await A.click('#aGo');
    ok('Kısa şifre uyarısı', (await A.textContent('#aErr')).includes('en az 6'));
    await A.fill('#aPass', 'gizli123'); await A.click('#aGo');
    await A.waitForFunction(() => document.querySelector('#aErr') && /yanlış/.test(document.querySelector('#aErr').textContent), null, { timeout: 8000 }).catch(() => {});
    ok('Olmayan hesapla giriş: Türkçe hata', (await A.textContent('#aErr')).includes('yanlış'), await A.textContent('#aErr'));
    await kayit(A, 'ayse@test.dev');
    await A.waitForSelector('#joinForm', { timeout: 15000 });
    ok('Kayıttan sonra ad soruluyor', await A.isVisible('#jNick'));
    ok('İlk girişte oda adı sorulmuyor', !(await A.$('#jRoom')));
    await A.fill('#jNick', 'Ayşe');
    await A.click('#joinForm button[type=submit]');
    await bekle(700);
    // Salon: "Oda kur" / "Odaya katıl". Pencereyi açar, adı yazar, gönderir; hata yazısını ya da '' döndürür
    const odaDene = async (p, tur, ad) => {
      await p.click(tur === 'kur' ? '[data-room-new]' : '[data-room-join]'); await p.waitForSelector('#roomForm');
      await p.fill('#rName', ad); await p.click('#roomForm button[type=submit]');
      for (let i = 0; i < 25; i++) { await bekle(120); if (!(await p.$('#roomForm')) || (await p.textContent('#rErr')).trim()) break; }
      const acik = !!(await p.$('#roomForm'));
      const hata = acik ? (await p.textContent('#rErr')).trim() : '';
      if (acik) await p.click('#roomForm [data-close-modal]');
      return hata;
    };
    await A.evaluate(() => { location.hash = 'salon'; }); await bekle(400);
    const yokOda = await odaDene(A, 'katil', 'Rastgele Uydurma');
    ok('Odaya katıl: olmayan odaya girilemiyor', yokOda === 'Böyle bir oda yok.' && !(await S.sql('select 1 from oda_uyeleri')).length, yokOda);
    const kurOda = await odaDene(A, 'kur', 'Kızlar 2027');
    await bekle(500);
    ok('Oda kur: oda kuruldu ve Salon\'da açıldı', kurOda === '' && (await A.textContent('#onlinePanel h2')) === 'Kızlar 2027 odası', kurOda);
    await A.evaluate(() => { location.hash = 'bugun'; }); await bekle(500);
    const ka = await kok('ayse@test.dev');
    ok('Profil sunucuya yazıldı (ad)', ka && ka.veri.nick === 'Ayşe', JSON.stringify(ka));
    ok('Oda adı herkese açık profilde YOK', ka && !('rooms' in ka.veri) && !('room' in ka.veri) && !JSON.stringify(ka.veri).includes('Kızlar'), JSON.stringify(ka && ka.veri));
    const od = await S.sql('select etiketler, anahtarlar from odalarim where uid = $1', [uidOf('ayse@test.dev')]);
    const uy = await S.sql('select oda from oda_uyeleri where uid = $1', [uidOf('ayse@test.dev')]);
    ok('Oda adı gizli tabloda, Türkçe harfiyle', od[0] && od[0].etiketler[0] === 'Kızlar 2027' && od[0].anahtarlar[0] === 'ki_zlar-2027', JSON.stringify(od));
    ok('Ortak tabloda yalnızca oda özeti var', uy.length === 1 && /^[0-9a-f]{32}$/.test(uy[0].oda), JSON.stringify(uy));

    // ---------- 2. Yedekten yükleme ----------
    const bugun = gun(), simdi = Date.now();
    const t0 = new Date(); t0.setHours(Math.max(0, t0.getHours() - 3), 0, 0, 0);
    const basla = Math.min(t0.getTime(), simdi - 100 * 60000);
    const dun = new Date(Date.now() - 864e5); dun.setHours(10, 0, 0, 0);
    const yedek = { uygulama: 'TusDostum', surum: 5, ayarlar: { goalMin: 300, examDate: '2027-03-28' },
      kronometreli: [
        { id: 'y1', d: gun(new Date(basla)), s: 'anatomi', t: 'konu', m: 60, mm: 60, st: basla, en: basla + 70 * 60000, b: 10, bn: 1, q: 0, c: 0, w: 0, n: 'gizli not', k: 'Üst ekstremite', ts: basla },
        { id: 'y2', d: gun(dun), s: 'dahiliye', t: 'soru', m: 50, mm: 50, st: dun.getTime(), en: dun.getTime() + 55 * 60000, b: 0, bn: 0, q: 40, c: 30, w: 10, n: '', k: '', ts: dun.getTime() }],
      elle: [{ id: 'e1', d: gun(dun), s: 'pediatri', t: 'tekrar', m: 45, q: 0, c: 0, w: 0, n: '', k: '', ts: dun.getTime() }],
      denemeler: [{ id: 'd1', n: 'Deneme 1', d: gun(dun), td: 70, ty: 20, kd: 65, ky: 25, ts: dun.getTime() }] };
    const yedekDosya = path.join(os.tmpdir(), 'td-yedek.json');
    fs.writeFileSync(yedekDosya, JSON.stringify(yedek));
    await A.click('#settingsBtn'); await A.waitForSelector('#gRestore');
    ok('Ayarlarda mola uyarısı alanı yok (zile taşındı), hesap ve çıkış var', !(await A.$('#gBW')) && (await A.textContent('.acct')).includes('ayse@test.dev') && !!(await A.$('#gOut')));
    await A.setInputFiles('#gFile', yedekDosya);
    await bekle(1200);
    const belgeler = await S.sql('select belge, veri from ozel_belgeler where uid = $1 order by belge', [uidOf('ayse@test.dev')]);
    const adlar = belgeler.map(x => x.belge);
    ok('Yedekteki kayıtlar özel alana yazıldı', adlar.some(x => x.startsWith('kron-')) && adlar.some(x => x.startsWith('elle-')) && adlar.includes('denemeler'), adlar.join(','));
    const ayar = belgeler.find(x => x.belge === 'ayar');
    ok('Yedekteki ayarlar (boş olanlar) dolduruldu', ayar && ayar.veri.goalMin === 300 && ayar.veri.examDate === '2027-03-28', JSON.stringify(ayar && ayar.veri));
    await A.setInputFiles('#gFile', yedekDosya);
    await bekle(600);
    ok('Aynı yedek ikinci kez yüklenince kayıt çoğalmıyor', (await A.textContent('#toast')).includes('zaten var'), await A.textContent('#toast'));
    await A.click('#setForm [data-close-modal]');
    const sg = await S.sql('select son from son_gunler where uid = $1', [uidOf('ayse@test.dev')]);
    ok('Son 10 gün özeti ayrı (korumalı) tabloya yazıldı', sg[0] && sg[0].son.length >= 1 && !JSON.stringify(sg[0].son).includes('gizli not'), JSON.stringify(sg));
    const ka2 = await kok('ayse@test.dev');
    ok('Profilde bugünün oturumu var, not ve konu yok', ka2.veri.day && ka2.veri.day.e.length === (gun(new Date(basla)) === bugun ? 1 : 0) && !JSON.stringify(ka2.veri).includes('gizli not') && !JSON.stringify(ka2.veri).includes('Üst ekstremite'), JSON.stringify(ka2.veri.day));
    ok('Son 10 gün profil satırında YOK', !('son' in ka2.veri));

    // ---------- 3. Zil: mola ve çalışma uyarısı, bildirim zamanlaması ----------
    ok('Kronometre kartında zil var', await A.isVisible('#timerCard .bell'));
    await A.click('#timerCard .bell'); await A.waitForSelector('#alForm');
    await A.click('[data-chips="breakWarn"] button[data-v="5"]');
    await A.click('[data-chips="workWarn"] button[data-v="25"]');
    await A.click('#alForm [data-close-modal]');
    await bekle(500);
    const ayar2 = (await S.sql(`select veri from ozel_belgeler where uid = $1 and belge = 'ayar'`, [uidOf('ayse@test.dev')]))[0].veri;
    ok('Uyarı süreleri ayarlara girmeden kaydedildi', ayar2.breakWarn === 5 && ayar2.workWarn === 25, JSON.stringify(ayar2));
    ok('Zil açık görünüyor', await A.$eval('#timerCard .bell', e => e.classList.contains('on')));
    ok('Kronometre durmuşken bekleyen uyarı yok', (await uyarilar('ayse@test.dev')).length === 0);
    await A.click('[data-act="start"]'); await bekle(700);
    let u = await uyarilar('ayse@test.dev');
    const fark = r => Math.round((new Date(r.zaman).getTime() - Date.now()) / 60000);
    ok('Başlayınca: çalışma uyarısı (25 dk) ve 3 saat sınırı sunucuda', u.length === 2 && u[0].tur === 'calisma' && u[0].dk === 25 && fark(u[0]) === 25 && u[1].tur === 'sinir' && fark(u[1]) === 180, JSON.stringify(u));
    await A.click('[data-act="pause"]'); await bekle(700);
    u = await uyarilar('ayse@test.dev');
    ok('Molada: yalnızca mola uyarısı (5 dk)', u.length === 1 && u[0].tur === 'mola' && u[0].dk === 5 && fark(u[0]) === 5, JSON.stringify(u));
    await A.click('[data-act="resume"]'); await bekle(700);
    u = await uyarilar('ayse@test.dev');
    ok('Çalışmaya dönünce: mola uyarısı kalkar, çalışma uyarısı yeniden kurulur', u.length === 2 && u[0].tur === 'calisma', JSON.stringify(u));

    // ---------- 4. İkinci kişi: davet bağlantısı, aynı oda ----------
    const davet = await A.evaluate(() => { location.hash = 'salon'; return null; }).then(async () => {
      await A.waitForSelector('[data-invite]'); await A.click('[data-invite]'); await A.waitForSelector('#invUrl');
      const v = await A.inputValue('#invUrl'); const t = await A.inputValue('#invText');
      await A.click('#invForm [data-close-modal]');
      return { v, t };
    });
    ok('Davet bağlantısı bu sitenin adresi, e-posta/düzenleyici adımı yok', davet.v.startsWith(S.adres) && davet.v.includes('#oda-') && !/claude|Düzenleyici|e-posta/i.test(davet.t), davet.v + ' | ' + davet.t);
    const B = await kisi(davet.v.slice(davet.v.indexOf('#')));
    await kayit(B, 'burak@test.dev');
    await B.waitForSelector('#joinForm', { timeout: 15000 });
    ok('Davetle gelen kişiye oda adı gösteriliyor', (await B.textContent('#joinForm .locked')).includes('Kızlar 2027'));
    await B.fill('#jNick', 'Burak'); await B.click('#joinForm button[type=submit]');
    await bekle(1500);
    const satir = async (p, ad) => p.evaluate(ad => { const r = [...document.querySelectorAll('#onlinePanel .person, #onlinePanel [data-profile]')].find(x => x.textContent.includes(ad)); return r ? { metin: r.textContent.replace(/\s+/g, ' ').trim(), dugme: r.tagName === 'BUTTON' } : null; }, ad);
    let sa = await satir(B, 'Ayşe');
    ok("B, odada A'yı görüyor ve A çalışıyor görünüyor", !!sa && /çalışıyor|Anatomi/i.test(sa.metin), JSON.stringify(sa));
    ok("Aynı odada: A'nın satırı profil açıyor", !!sa && sa.dugme);
    await B.click('#onlinePanel [data-profile="' + uidOf('ayse@test.dev') + '"]');
    await B.waitForSelector('#profileOverlay:not([hidden])');
    const prof = (await B.textContent('#profileOverlay')).replace(/\s+/g, ' ');
    ok("B, A'nın son 10 gününü (ders ayrıntısıyla) görüyor", /Son 10 gün/i.test(prof) && /Dahiliye|Anatomi/.test(prof), prof.slice(0, 300));
    ok('Profilde özel not ve konu görünmüyor', !prof.includes('gizli not') && !prof.includes('Üst ekstremite'));
    await B.click('#profileOverlay [data-close-prof]');

    // ---------- 5. Üçüncü kişi: odasız (yalnızca Genel) ----------
    const C = await kisi();
    await kayit(C, 'cem@test.dev');
    await C.waitForSelector('#joinForm', { timeout: 15000 });
    await C.fill('#jNick', 'Cem'); await C.click('#joinForm button[type=submit]');
    await bekle(600);
    await C.evaluate(() => { location.hash = 'salon'; }); await bekle(1500);
    sa = await satir(C, 'Ayşe');
    const sb = await satir(C, 'Burak');
    ok("Genel'de herkes listeleniyor", !!sa && !!sb, JSON.stringify([sa, sb]));
    ok("Genel'de başkasının satırı profil AÇMIYOR", !!sa && !sa.dugme);
    ok('Kronometresi olmayan ama sayfası açık kişi "Çevrimiçi" görünüyor (canlı bağlantı)', !!sb && /Çevrimiçi/.test(sb.metin), JSON.stringify(sb));
    // Anlık güncelleme: A adını değiştirir, C hiçbir şey yapmadan görür
    await A.click('#settingsBtn'); await A.waitForSelector('#gNick'); await A.fill('#gNick', 'Ayşe K.'); await A.click('#setForm button[type=submit]');
    let anlik = false;
    for (let i = 0; i < 15 && !anlik; i++) { await bekle(200); anlik = !!(await satir(C, 'Ayşe K.')); }
    ok('Başkasının değişikliği 3 saniye içinde kendiliğinden görünüyor (anlık güncelleme)', anlik);
    const cSon = await C.evaluate(async uid => { const r = await fetch('/api/q', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ uid, kind: 'select', table: 'son_gunler', cols: 'uid,son' }) }); return (await r.json()).data; }, uidOf('cem@test.dev'));
    ok('Sunucu, odasız kişiye başkasının son 10 gününü VERMİYOR', Array.isArray(cSon) && cSon.every(r => r.uid === uidOf('cem@test.dev')), JSON.stringify(cSon));
    const cOzel = await C.evaluate(async uid => { const r = await fetch('/api/q', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ uid, kind: 'select', table: 'ozel_belgeler', cols: 'uid,belge' }) }); return (await r.json()).data; }, uidOf('cem@test.dev'));
    ok('Sunucu, başkasının özel kayıtlarını VERMİYOR', Array.isArray(cOzel) && cOzel.every(r => r.uid === uidOf('cem@test.dev')), JSON.stringify(cOzel));
    const c1 = await odaDene(C, 'katil', 'Uydurma Oda');
    const c2 = await odaDene(C, 'kur', 'kızlar 2027');
    ok('Odasız kişi uydurma odaya giremiyor; var olan adla (adı göremese de) oda kuramıyor', c1 === 'Böyle bir oda yok.' && c2 === 'Bu adda bir oda var.' && !(await S.sql('select 1 from oda_uyeleri where uid = $1', [uidOf('cem@test.dev')])).length, c1 + ' | ' + c2);

    // ---------- 6. Canlı sıralama ----------
    await B.evaluate(() => { location.hash = 'salon'; }); await bekle(400);
    const rank = (await B.textContent('#rankPanel')).replace(/\s+/g, ' ');
    ok('Canlı sıralamada A önde (bugünkü oturumu + çalışan kronometresi)', rank.indexOf('Ayşe') >= 0 && (rank.indexOf('Burak') < 0 || rank.indexOf('Ayşe') < rank.indexOf('Burak')), rank.slice(0, 200));

    // ---------- 7. Yenileme ve çıkış/giriş ----------
    await A.reload(); await bekle(1800);
    ok('Yenileyince oturum sürüyor (giriş ekranı yok)', !(await A.$('#authView')));
    ok('Yenileyince kronometre sürüyor', await A.evaluate(() => /Çalışıyor/.test(document.querySelector('#timerCard').textContent)));
    await A.evaluate(() => { location.hash = 'kayitlar'; }); await bekle(500);
    const kayitSayi = await A.evaluate(() => document.querySelector('#logPanel').textContent.replace(/\s+/g, ' '));
    ok('Kayıtlar yenilemeden sonra duruyor', /Anatomi/.test(kayitSayi) || /Dahiliye/.test(kayitSayi), kayitSayi.slice(0, 200));
    await A.click('#settingsBtn'); await A.waitForSelector('#gOut'); await A.click('#gOut');
    await A.waitForSelector('#authView', { timeout: 10000 });
    ok('Çıkış yapınca giriş ekranı geliyor', true);
    await giris(A, 'ayse@test.dev', 'yanlis-sifre');
    await A.waitForFunction(() => document.querySelector('#aErr') && /yanlış/.test(document.querySelector('#aErr').textContent), null, { timeout: 8000 }).catch(() => {});
    ok('Yanlış şifre reddediliyor', (await A.textContent('#aErr')).includes('yanlış'));
    await A.fill('#aPass', 'gizli123'); await A.click('#aGo');
    await A.waitForFunction(() => !document.querySelector('#authView') && /Çalışıyor/.test(document.querySelector('#timerCard').textContent), null, { timeout: 15000 });
    ok('Yeniden girişte kronometre ve veriler geri geliyor', true);

    // ---------- 8. İki cihaz: kayıtlar birbirini ezmiyor ----------
    const A2 = await kisi();
    await giris(A2, 'ayse@test.dev');
    await A2.waitForFunction(() => !document.querySelector('#authView') && /Çalışıyor/.test(document.querySelector('#timerCard').textContent), null, { timeout: 15000 });
    ok('İkinci cihazda aynı kronometre görünüyor', true);
    const elleEkle = async (p, dk) => {
      await p.evaluate(() => { location.hash = 'bugun'; }); await bekle(300);
      await p.click('[data-act="manual"]'); await p.waitForSelector('#entryForm');
      await p.fill('#fM', String(dk)); await p.click('#entryForm button[type=submit]');
    };
    await Promise.all([elleEkle(A, 11), elleEkle(A2, 13)]);
    await bekle(1500);
    const ym = bugun.slice(0, 7);
    const elle = (await S.sql('select veri from ozel_belgeler where uid = $1 and belge = $2', [uidOf('ayse@test.dev'), 'elle-' + ym]))[0];
    const dkler = elle ? Object.values(elle.veri.entries).map(e => e.m).sort((x, y) => x - y) : [];
    ok('İki cihazdan aynı anda eklenen iki kayıt da duruyor', dkler.includes(11) && dkler.includes(13), JSON.stringify(dkler));
    await A2.close();

    // ---------- 8b. Adını bilen kişi var olan odaya katılır ----------
    const c3 = await odaDene(C, 'katil', 'KIZLAR 2027');
    await bekle(1200);
    const ortak = await S.sql('select count(distinct uid)::int as n from oda_uyeleri where oda = (select oda from oda_uyeleri where uid = $1 limit 1)', [uidOf('ayse@test.dev')]);
    const cA = await satir(C, 'Ayşe');
    ok('Odaya katıl: adını bilen kişi odaya giriyor (büyük/küçük harf fark etmez) ve oda arkadaşının profilini açabiliyor', c3 === '' && ortak[0].n === 3 && !!cA && cA.dugme, c3 + ' ' + JSON.stringify(ortak) + ' ' + JSON.stringify(cA));

    // ---------- 9. Yönetici: kişi çıkarma ----------
    await S.sql('insert into yoneticiler (uid) values ($1)', [uidOf('ayse@test.dev')]);
    await A.reload(); await bekle(1800);
    await A.evaluate(() => { location.hash = 'salon'; }); await bekle(600);
    await A.evaluate(() => { const g = [...document.querySelectorAll('#onlinePanel [data-room]')].find(x => /Genel/.test(x.textContent)); if (g) g.click(); }); await bekle(600);
    const cDugme = await A.$('#onlinePanel [data-profile="' + uidOf('cem@test.dev') + '"]');
    ok("Yönetici Genel'de kişiye dokunabiliyor", !!cDugme);
    if (cDugme) {
      await cDugme.click(); await A.waitForSelector('#profileOverlay [data-kick]'); await A.click('#profileOverlay [data-kick]');
      await A.waitForSelector('[data-kick-yes]'); await A.click('[data-kick-yes]'); await bekle(1200);
    }
    ok('Çıkarılan kişinin profili sunucudan silindi ve engellendi', !(await S.sql('select 1 from profiller where uid = $1', [uidOf('cem@test.dev')])).length && (await S.sql('select 1 from engelliler where uid = $1', [uidOf('cem@test.dev')])).length === 1);
    await bekle(800);
    ok("Çıkarılan kişi B'nin listesinden de düştü", !(await satir(B, 'Cem')));
    await C.reload(); await bekle(2000);
    ok('Çıkarılan kişi kayıt ekleyemiyor (uyarı gösteriliyor)', (await C.textContent('#banner')).includes('kapatılmış') && await C.$eval('[data-act="start"]', e => e.disabled), await C.textContent('#banner'));
    ok('Çıkarılan kişi sunucuda yeniden görünmedi', !(await S.sql('select 1 from profiller where uid = $1', [uidOf('cem@test.dev')])).length);

    if (GERCEK) {
      // Sayfası kapanan kişi çevrimdışına düşer (gerçek bağlantıda sunucu bunu kendisi bildirir)
      await A.evaluate(() => { const g = [...document.querySelectorAll('#onlinePanel [data-room]')].find(x => !/Genel/.test(x.textContent)); if (g) g.click(); }); await bekle(500);
      const once = await satir(A, 'Burak');
      await B.context().close();
      let dustu = false;
      for (let i = 0; i < 20 && !dustu; i++) { await bekle(250); const r = await satir(A, 'Burak'); dustu = !!r && /Çevrimdışı/.test(r.metin); }
      ok('Sayfasını kapatan kişi "Çevrimdışı" oluyor ama listede kalıyor', !!once && /Çevrimiçi/.test(once.metin) && dustu, JSON.stringify(once));
    }
    ok('Sayfa hatası yok', hatalar.length === 0, hatalar.join(' | '));
  } catch (e) {
    ok('Test akışı tamamlandı', false, (e && e.stack) || String(e));
    ok('Sayfa hatası yok', hatalar.length === 0, hatalar.join(' | '));
  }
  console.log(out.join('\n'));
  console.log(`\n${out.filter(x => x.startsWith('GEÇTİ')).length} geçti, ${out.filter(x => x.startsWith('KALDI')).length} kaldı`);
  await b.close(); await S.kapat();
})();
