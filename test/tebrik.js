// Tebrik ve dürtme: yalnızca ortak kişisel odadakiler arasında; çalışırken açılır kart yok, molada bir kez çıkar.
// Gerçek PostgreSQL + satır güvenliği ile.
// Çalıştırma: NODE_PATH="$(npm root -g):<pg'nin olduğu node_modules>" [GERCEK=1] node test/tebrik.js
const { chromium } = require('playwright');
const { baslat } = require('./sahte-supabase.js');
const out = [];
const ok = (ad, kosul, ek = '') => out.push(`${kosul ? 'GEÇTİ ' : 'KALDI '} ${ad}${!kosul && ek ? ' — ' + ek : ''}`);
const bekle = ms => new Promise(r => setTimeout(r, ms));
const CEK = process.env.CEK;                                         // klasör verilirse ekran görüntüsü alınır
const cek = async (p, ad) => { if (CEK) await p.screenshot({ path: require('path').join(CEK, ad + '.png') }); };

(async () => {
  const GERCEK = process.env.GERCEK === '1';
  const S = await baslat(0, { gercek: GERCEK });
  console.log(GERCEK ? 'İstemci: GERÇEK supabase-js' : 'İstemci: sahte istemci');
  const b = await chromium.launch();
  const hatalar = [];
  const zaman = {}; let B_SAYFA = null;                                                   // video için: kaydın başlangıcına göre saniye
  const kisi = async (hash = '', video = false) => {
    const ctx = await b.newContext({ viewport: { width: 390, height: 780 }, hasTouch: true, serviceWorkers: 'block', ...(video && CEK ? { recordVideo: { dir: CEK, size: { width: 390, height: 780 } } } : {}) });
    if (video) zaman.bas = Date.now();
    const p = await ctx.newPage();
    p.on('pageerror', e => hatalar.push(e.message));
    await p.goto(S.adres + '/' + hash);
    return p;
  };
  const kayit = async (p, mail, ad) => {
    await p.waitForSelector('#authView');
    await p.click('#authView [data-mode="kayit"]');
    await p.fill('#aMail', mail); await p.fill('#aPass', 'gizli123'); await p.click('#aGo');
    await p.waitForSelector('#joinForm', { timeout: 15000 });
    await p.fill('#jNick', ad); await p.click('#joinForm button[type=submit]');
    await bekle(1200);
  };
  const uidOf = mail => S.hesaplar.get(mail).id;
  const etk = async () => S.sql('select id, gonderen, alici, tur, goruldu, bildirim_bekliyor from etkilesimler order by id');
  const profilAc = async (p, uid) => {
    await p.evaluate(() => { location.hash = 'salon'; }); await bekle(300);
    await p.click(`#onlinePanel [data-profile="${uid}"]`);
    await p.waitForSelector('#profileOverlay:not([hidden])');
    await bekle(900);                                                 // düğme durumu sunucudan gelir
  };
  const profilKapat = async p => { await p.click('#profileOverlay [data-close-prof]'); await bekle(200); };
  const dugme = (p, tur) => p.evaluate(t => { const x = document.querySelector(`#profileOverlay [data-etk="${t}"]`); return x ? { var: true, acik: !x.disabled, yazi: x.textContent.trim() } : { var: false }; }, tur);
  const toastBekle = async (p, re) => { for (let i = 0; i < 30; i++) { const t = await p.textContent('#toast').catch(() => ''); if (re.test(t)) return t; await bekle(100); } return p.textContent('#toast').catch(() => ''); };
  const anlik = p => p.evaluate(() => { const x = document.querySelector('.tb-anlik'); return x ? x.textContent.replace(/\s+/g, ' ').trim() : ''; });
  const anlikBekle = async (p, ms) => { for (let i = 0; i < ms / 200; i++) { const t = await anlik(p); if (t) return t; await bekle(200); } return ''; };

  try {
    // ---------- Kurulum: A oda kurar, B davetle aynı odaya girer, C odasız ----------
    const A = await kisi();
    await kayit(A, 'ayse@test.dev', 'Ayşe');
    await A.evaluate(() => { location.hash = 'salon'; }); await bekle(300);
    await A.click('[data-room-plus]'); await A.waitForSelector('#roomChoice'); await A.click('#roomChoice [data-room-new]'); await A.waitForSelector('#roomForm');
    await A.fill('#rName', 'TSM'); await A.click('#roomForm button[type=submit]'); await bekle(1500);
    await A.evaluate(() => { location.hash = 'salon'; }); await A.waitForSelector('[data-invite]'); await A.click('[data-invite]'); await A.waitForSelector('#invUrl');
    const davet = await A.inputValue('#invUrl'); await A.click('#invForm [data-close-modal]');
    const B = await kisi(davet.slice(davet.indexOf('#')), true); B_SAYFA = B;
    await kayit(B, 'burak@test.dev', 'Burak');
    const C = await kisi();
    await kayit(C, 'cem@test.dev', 'Cem');
    const uA = uidOf('ayse@test.dev'), uB = uidOf('burak@test.dev'), uC = uidOf('cem@test.dev');
    await bekle(1500);

    // ---------- 1. Ortak oda şartı ----------
    const cSonuc = await C.evaluate(u => window.TusAltyapi.etkilesim.gonder(u, 'durt'), uB);
    const cTebrik = await C.evaluate(u => window.TusAltyapi.etkilesim.gonder(u, 'tebrik'), uB);
    ok('Ortak odası olmayan kişi dürtemiyor ve tebrik edemiyor', cSonuc === 'ortak_oda_yok' && cTebrik === 'ortak_oda_yok' && !(await etk()).length, cSonuc + ' ' + cTebrik);
    const kendine = await A.evaluate(u => window.TusAltyapi.etkilesim.gonder(u, 'tebrik'), uA).catch(e => 'hata');
    ok('Kişi kendini tebrik edemiyor', kendine !== 'tamam' && !(await etk()).length, String(kendine));

    // ---------- 2. Henüz çalışmamış kişi: Dürt açık, Tebrik kapalı ----------
    await profilAc(A, uB);
    let dT = await dugme(A, 'tebrik'), dD = await dugme(A, 'durt');
    ok('Bugün çalışmamış oda arkadaşı: "Dürt" açık, "Tebrik et" kapalı', dD.var && dD.acik && dT.var && !dT.acik, JSON.stringify([dT, dD]));
    await cek(A, '1-profil-durt');
    const ipucu = (await A.textContent('#profileOverlay .kd-hint').catch(() => '')).trim();
    ok('İpucu: "Burak bugün henüz çalışmadı"', /Burak bugün henüz çalışmadı/.test(ipucu), ipucu);
    await A.click('#profileOverlay [data-etk="durt"]');
    const t1 = await toastBekle(A, /gönderildi/);
    await bekle(800);
    let satirlar = await etk();
    ok('Dürtme gönderildi ve kaydedildi', /Dürtme gönderildi/.test(t1) && satirlar.length === 1 && satirlar[0].tur === 'durt' && satirlar[0].gonderen === uA && satirlar[0].alici === uB, t1 + ' ' + JSON.stringify(satirlar));
    ok('Dürtme bildirimi kuyruğa girdi (alıcı çalışmıyor)', satirlar[0] && satirlar[0].bildirim_bekliyor === true);
    dD = await dugme(A, 'durt');
    ok('Gönderdikten sonra düğme "Dürtüldü ✓" ve kapalı', dD.var && !dD.acik && /Dürtüldü/.test(dD.yazi), JSON.stringify(dD));
    const tekrar = await A.evaluate(u => window.TusAltyapi.etkilesim.gonder(u, 'durt'), uB);
    ok('Aynı kişi aynı gün ikinci kez dürtemiyor', tekrar === 'zaten' && (await etk()).length === 1, tekrar);
    await profilKapat(A);

    // ---------- 3. Dürtülen kişi: "Bugün" sayfasında kart ----------
    await B.evaluate(() => { location.hash = 'bugun'; });
    let kart = '';
    for (let i = 0; i < 40 && !kart; i++) { await bekle(300); kart = (await B.textContent('#etkKartlar').catch(() => '')).replace(/\s+/g, ' ').trim(); }
    zaman.durt = (Date.now() - zaman.bas) / 1000;
    ok('B\'nin "Bugün" sayfasında: "Ayşe seni dürttü · TSM odası"', /Ayşe seni dürttü/.test(kart) && /TSM odası/.test(kart) && /Başlat/.test(kart), kart);
    await cek(B, '2-durt-karti');
    ok('Dürtme, açılır tebrik kartı çıkarmıyor', !(await anlik(B)));

    // ---------- 4. Kronometre başlayınca kart yumuşakça kaybolur; molada geri gelmez ----------
    await bekle(1200); zaman.basla = (Date.now() - zaman.bas) / 1000;
    await B.click('.timer-card [data-act="start"], [data-act="start"]'); await bekle(100);
    const kayiyor = await B.evaluate(() => !!document.querySelector('#etkKartlar .kd-card.gidiyor'));
    await bekle(700);
    ok('Kronometre başlayınca dürtme kartı yumuşakça kayboldu', kayiyor && await B.evaluate(() => !!document.querySelector('[data-act="pause"]')) && !(await B.textContent('#etkKartlar')).trim(), String(kayiyor));
    await B.click('[data-act="pause"]'); await bekle(1500);
    ok('Mola verince dürtme kartı GERİ GELMEDİ', !(await B.textContent('#etkKartlar')).trim(), await B.textContent('#etkKartlar'));
    await B.click('[data-act="resume"]'); await bekle(300);
    await bekle(1500);

    // ---------- 5. Çalışan kişi tebrik edilir; dikkati dağılmaz ----------
    await profilAc(A, uB);
    dT = await dugme(A, 'tebrik'); dD = await dugme(A, 'durt');
    await cek(A, '3-profil-tebrik');
    ok('Çalışan oda arkadaşı: "Tebrik et" açık, "Dürt" kapalı', dT.var && dT.acik && dD.var && !dD.acik, JSON.stringify([dT, dD]));
    await A.click('#profileOverlay [data-etk="tebrik"]');
    const t2 = await toastBekle(A, /Tebrik gönderildi/);
    await bekle(1000);
    satirlar = await etk();
    const tb = satirlar.find(x => x.tur === 'tebrik');
    ok('Tebrik gönderildi', /Tebrik gönderildi/.test(t2) && !!tb, t2);
    ok('Çalışan kişiye tebrik bildirimi (telefon) gitmiyor', tb && tb.bildirim_bekliyor === false, JSON.stringify(tb));
    const basl = (await A.textContent('#profileOverlay')).replace(/\s+/g, ' ');
    ok('Profilde toplam tebrik: "👏 1 tebrik"', /👏 1 tebrik/.test(basl), basl.slice(0, 200));
    await profilKapat(A);
    await A.evaluate(() => { location.hash = 'salon'; }); await bekle(800);
    const cip = await A.evaluate(u => { const r = document.querySelector(`#onlinePanel [data-profile="${u}"] .kd-chip`); return r ? r.textContent.trim() : ''; }, uB);
    await cek(A, '4-oda-sayi');
    ok('Odada B\'nin adının yanında bugünkü tebrik: "👏 1"', cip === '👏 1', cip);
    await bekle(2500);                                               // canlı güncelleme + denetim süresi
    await B.evaluate(() => window.dispatchEvent(new Event('focus')));
    ok('B çalışırken açılır tebrik kartı ÇIKMADI', !(await anlik(B)));
    ok('Çalışırken tebrik "görülmedi" olarak bekliyor', (await etk()).find(x => x.tur === 'tebrik').goruldu === false);

    // ---------- 6. Mola: açılır kart bir kez ----------
    await B.click('[data-act="pause"]');
    const kartMetni = await anlikBekle(B, 4000);
    await bekle(500); await cek(B, '5-mola-tebrik');
    ok('Mola verince açılır kart: "Ayşe seni tebrik etti"', /Ayşe seni tebrik etti/.test(kartMetni), kartMetni);
    ok('Kartta yalnızca "Çalışırken gönderdi" (sayı yok)', /Çalışırken gönderdi$/.test(kartMetni) && !/\d/.test(kartMetni), kartMetni);
    const orta = await B.evaluate(() => { const k = document.querySelector('.tb-anlik .kutu').getBoundingClientRect(), o = getComputedStyle(document.querySelector('.tb-anlik')); return { dy: Math.abs((k.top + k.bottom) / 2 - innerHeight / 2), dx: Math.abs((k.left + k.right) / 2 - innerWidth / 2), bulanik: /blur/.test(o.backdropFilter || o.webkitBackdropFilter || '') }; });
    ok('Pencere ekranın ortasında, arkası bulanık', orta.dy < 4 && orta.dx < 4 && orta.bulanik, JSON.stringify(orta));
    await bekle(800);
    ok('Görülünce sunucuda "görüldü" işaretlendi', (await etk()).find(x => x.tur === 'tebrik').goruldu === true);
    await bekle(5500);
    ok('Pencere kendiliğinden kapanmıyor', !!(await anlik(B)));
    await B.mouse.click(30, 700); await bekle(300);
    ok('Dokununca kapanıyor', !(await anlik(B)));
    await B.reload(); await bekle(3500);
    ok('Yeniden açılışta aynı tebrik tekrar gösterilmiyor', !(await anlik(B)));
    const tekrarT = await A.evaluate(u => window.TusAltyapi.etkilesim.gonder(u, 'tebrik'), uB);
    ok('Aynı kişi aynı gün ikinci kez tebrik edemiyor', tekrarT === 'zaten', tekrarT);

    // ---------- 6b. Günde 5 saat: uygulamanın tebriki (çalışırken sessiz, molada kart) ----------
    await B.click('[data-act="resume"]'); await bekle(800);
    const gunB = await B.evaluate(() => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); });
    const simdi = Date.now();
    const kayitlarB = { entries: { u1: { d: gunB, s: 'anatomi', t: 'konu', m: 180, mm: 180, st: simdi - 330 * 60000, en: simdi - 150 * 60000, b: 0, bn: 0, q: 0, c: 0, w: 0 },
      u2: { d: gunB, s: 'dahiliye', t: 'soru', m: 125, mm: 125, st: simdi - 140 * 60000, en: simdi - 15 * 60000, b: 0, bn: 0, q: 0, c: 0, w: 0 } } };
    await S.sql(`insert into ozel_belgeler (uid, belge, veri) values ($1, $2, $3) on conflict (uid, belge) do update set veri = ozel_belgeler.veri || excluded.veri`, [uB, 'kron-' + gunB.slice(0, 7), kayitlarB]);
    await B.reload();
    let sistem = null;
    for (let i = 0; i < 40 && !sistem; i++) { await bekle(250); sistem = (await etk()).find(x => x.tur === 'tebrik' && !x.gonderen); }
    ok('5 saati geçince uygulamanın tebriki kaydedildi (gönderen yok, telefona bildirim yok)', !!sistem && sistem.alici === uB && sistem.bildirim_bekliyor === false, JSON.stringify(sistem));
    await bekle(1500);
    ok('Çalışırken 5 saat tebriki için açılır kart ÇIKMADI', !(await anlik(B)));
    await B.evaluate(() => { window.__osc = 0; const C = window.AudioContext.prototype, o = C.createOscillator; C.createOscillator = function () { window.__osc++; return o.call(this); }; });
    zaman.ac = (Date.now() - zaman.bas) / 1000;
    await B.click('[data-act="pause"]');
    const hedefKart = await anlikBekle(B, 4000);
    await bekle(500); await cek(B, '6-bes-saat');
    await bekle(400);
    const osc = await B.evaluate(() => window.__osc);
    ok('Tebrik gelince marimba sesi çalıyor (iki nota)', osc === 6, String(osc));
    ok('Mola verince yalnızca: "Tebrikler, 5 saati geçtin!"', hedefKart.replace('👏', '').trim() === 'Tebrikler, 5 saati geçtin!', hedefKart);
    const tebrikB = (await S.sql('select toplam, bugun from tebrik_ozet where uid = $1', [uB]))[0];
    ok('5 saat tebriki toplama ve bugüne eklendi (2)', tebrikB && tebrikB.toplam === 2 && tebrikB.bugun === 2, JSON.stringify(tebrikB));
    await A.evaluate(() => { location.hash = 'salon'; }); await bekle(1500);
    const cip2 = await A.evaluate(u => { const r = document.querySelector(`#onlinePanel [data-profile="${u}"] .kd-chip`); return r ? r.textContent.trim() : ''; }, uB);
    ok('Odada B\'nin adının yanında: "👏 2"', cip2 === '👏 2', cip2);
    zaman.kapat = (Date.now() - zaman.bas) / 1000;
    await B.click('.tb-anlik'); await bekle(300);
    await B.reload(); await bekle(3500);
    ok('5 saat tebriki aynı gün ikinci kez verilmiyor ve gösterilmiyor', (await etk()).filter(x => !x.gonderen).length === 1 && !(await anlik(B)));

    // ---------- 7. Genel odada tebrik/dürt yok ----------
    const genelde = await A.evaluate(() => { const g = [...document.querySelectorAll('#onlinePanel [data-room]')].find(x => /Genel/.test(x.textContent)); if (g) g.click(); return !!g; });
    await bekle(800);
    const genelCip = await A.evaluate(() => document.querySelectorAll('#onlinePanel .kd-chip').length);
    ok('Genel odada tebrik sayısı görünmüyor', genelde && genelCip === 0, String(genelCip));
    await A.evaluate(() => { const g = [...document.querySelectorAll('#onlinePanel [data-room]')].find(x => !/Genel/.test(x.textContent)); if (g) g.click(); }); await bekle(600);

    // ---------- 8. Dürtmeleri kapatma ayarı ----------
    await A.click('#settingsBtn'); await A.waitForSelector('#gDurt');
    await A.uncheck('#gDurt'); await A.click('#setForm button[type=submit]'); await bekle(1200);
    const ayar = (await S.sql(`select veri from ozel_belgeler where uid = $1 and belge = 'ayar'`, [uA]))[0];
    ok('Ayar: "Dürtmelere izin ver" kapatıldı', ayar && ayar.veri.durtmeKapali === true, JSON.stringify(ayar && ayar.veri));
    const bA = await B.evaluate(u => window.TusAltyapi.etkilesim.gonder(u, 'durt'), uA);
    ok('Dürtmeleri kapalı kişi dürtülemiyor', bA === 'kapali', bA);
    await profilAc(B, uA);
    ok('Dürtmeleri kapalı kişinin profilinde "Dürt" düğmesi yok', !(await dugme(B, 'durt')).var);
    await profilKapat(B);

    // ---------- 9. Kayıtlar ve istatistikler etkilenmedi ----------
    const kayitlar = await S.sql(`select count(*)::int n from ozel_belgeler where uid = any($1) and (belge like 'kron-%' or belge like 'elle-%')`, [[uA, uC]]);
    ok('Tebrik/dürtme hiçbir çalışma kaydı oluşturmadı', kayitlar[0].n === 0, JSON.stringify(kayitlar));
    ok('Sayfa hatası yok', !hatalar.length, hatalar.join(' | '));
  } catch (e) {
    ok('Test akışı tamamlandı', false, e.stack || e.message);
  } finally {
    const videoYol = CEK && zaman.ac ? await (async () => { try { const v = B_SAYFA && B_SAYFA.video(); await B_SAYFA.context().close(); return v ? await v.path() : null; } catch { return null; } })() : null;
    await b.close(); await S.kapat();
    if (videoYol) require('fs').writeFileSync(require('path').join(CEK, 'video.json'), JSON.stringify({ yol: videoYol, ...zaman }));
    console.log(out.join('\n'));
    console.log(`\n${out.filter(x => x.startsWith('GEÇTİ')).length} geçti, ${out.filter(x => x.startsWith('KALDI')).length} kaldı`);
    process.exit(out.some(x => x.startsWith('KALDI')) ? 1 : 0);
  }
})();
