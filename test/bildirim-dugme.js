// "Bildirimleri aç" düğmesi: izin verilmemiş cihazda görünür, basınca cihaz kaydolur, sessiz ses kaydı çalmaz.
// Çalıştırma: NODE_PATH="$(npm root -g):<pg'nin olduğu node_modules>" node test/bildirim-dugme.js
const { chromium } = require('playwright');
const { baslat } = require('./sahte-supabase.js');
const out = [];
const ok = (ad, kosul, ek = '') => out.push(`${kosul ? 'GEÇTİ ' : 'KALDI '} ${ad}${!kosul && ek ? ' — ' + ek : ''}`);
const bekle = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const S = await baslat(0, { vapid: 'BHn1d0ZEW1h9QBOcSfdRRnlSHyLdVjXjtJLTtW7_d7TPa6S9SBu5QRNdj6aE4zdgM2-5-6bZnzGvwZkO2TzA2Nc' });
  const b = await chromium.launch({ channel: 'chromium' });
  const ctx = await b.newContext({ viewport: { width: 390, height: 780 }, hasTouch: true });
  // Başsız tarayıcıda gerçek bildirim servisi yok: aboneliği taklit et; izin durumunu test yönetir
  await ctx.addInitScript(() => {
    const sahte = { endpoint: 'https://bildirim.ornek.invalid/push/1', getKey: ad => new Uint8Array(ad === 'p256dh' ? 65 : 16).fill(4).buffer, unsubscribe: async () => true };
    if (window.PushManager) {
      PushManager.prototype.subscribe = async function () { localStorage.setItem('sahte.abone', '1'); return sahte; };
      PushManager.prototype.getSubscription = async function () { return localStorage.getItem('sahte.abone') ? sahte : null; };
    }
    // İzin penceresi: test "izin.ver" bayrağını koyarsa kabul edilmiş sayılır
    const gercek = Notification.requestPermission.bind(Notification);
    Notification.requestPermission = async () => (localStorage.getItem('izin.ver') ? gercek() : 'default');
  });
  const p = await ctx.newPage();
  const hatalar = []; p.on('pageerror', e => hatalar.push(e.message));
  try {
    await p.goto(S.adres + '/');
    await p.waitForSelector('#authView');
    await p.click('#authView [data-mode="kayit"]'); await p.fill('#aMail', 'zil@test.dev'); await p.fill('#aPass', 'gizli123'); await p.click('#aGo');
    await p.waitForSelector('#joinForm', { timeout: 15000 }); await p.fill('#jNick', 'Zil'); await p.click('#joinForm button[type=submit]'); await bekle(600);
    const uid = S.hesaplar.get('zil@test.dev').id;
    ok('Uyarı kapalıyken kartta bildirim düğmesi yok', !(await p.$('[data-act="push-on"]')));
    await p.click('#timerCard .bell'); await p.waitForSelector('#alForm');
    await p.click('[data-chips="breakWarn"] button[data-v="5"]'); await bekle(500);
    ok('İzin verilmeyince pencerede "Bildirimleri aç" düğmesi var', !!(await p.$('#alPush')));
    await p.click('#alForm [data-close-modal]');
    ok('Kartta "Bildirimleri aç" düğmesi var (≥44 px)', await p.$eval('[data-act="push-on"]', e => e.getBoundingClientRect().height >= 44).catch(() => false));
    ok('Henüz cihaz kaydı yok', !(await S.sql('select 1 from push_abonelikleri where uid = $1', [uid])).length);
    // izin verilir ve düğmeye basılır
    await ctx.grantPermissions(['notifications'], { origin: S.adres });
    await p.evaluate(() => localStorage.setItem('izin.ver', '1'));
    await p.click('[data-act="push-on"]'); await bekle(1200);
    ok('Düğmeye basınca cihaz sunucuya kaydoldu', (await S.sql('select 1 from push_abonelikleri where uid = $1', [uid])).length === 1);
    ok('Kayıttan sonra kartta düğme kalmıyor', !(await p.$('[data-act="push-on"]')));
    await p.click('#timerCard .bell'); await p.waitForSelector('#alForm');
    ok('Pencerede "Bildirimler açık." yazıyor', (await p.textContent('#alNote')).includes('Bildirimler açık'));
    await p.click('#alForm [data-close-modal]');
    await p.click('[data-act="start"]'); await bekle(400); await p.click('[data-act="pause"]'); await bekle(700);
    ok('Mola verince sessiz ses kaydı çalmıyor', await p.evaluate(() => !(navigator.mediaSession && navigator.mediaSession.metadata)));
    ok('Mola uyarısı sunucuda bekliyor', (await S.sql(`select 1 from uyarilar where uid = $1 and tur = 'mola'`, [uid])).length === 1);
    await p.reload(); await bekle(2000);
    ok('Yeniden açılışta kayıt kendiliğinden sürüyor, düğme çıkmıyor', !(await p.$('[data-act="push-on"]')) && (await S.sql('select 1 from push_abonelikleri where uid = $1', [uid])).length === 1);
    // İkinci kişi: zile İLK basışta izin penceresi çıkar ve izin verilince cihaz hemen kaydolur
    const ctx2 = await b.newContext({ viewport: { width: 390, height: 780 }, hasTouch: true });
    await ctx2.addInitScript(() => {
      const sahte = { endpoint: 'https://bildirim.ornek.invalid/push/2', getKey: ad => new Uint8Array(ad === 'p256dh' ? 65 : 16).fill(5).buffer, unsubscribe: async () => true };
      if (window.PushManager) {
        PushManager.prototype.subscribe = async function () { localStorage.setItem('sahte.abone', '1'); return sahte; };
        PushManager.prototype.getSubscription = async function () { return localStorage.getItem('sahte.abone') ? sahte : null; };
      }
      window.__izinSoruldu = 0;
      const gercek = Notification.requestPermission.bind(Notification);
      Notification.requestPermission = async () => { window.__izinSoruldu++; return localStorage.getItem('izin.ver') ? gercek() : 'default'; };
    });
    const q = await ctx2.newPage(); q.on('pageerror', e => hatalar.push(e.message));
    await q.goto(S.adres + '/');
    await q.waitForSelector('#authView');
    await q.click('#authView [data-mode="kayit"]'); await q.fill('#aMail', 'zil2@test.dev'); await q.fill('#aPass', 'gizli123'); await q.click('#aGo');
    await q.waitForSelector('#joinForm', { timeout: 15000 }); await q.fill('#jNick', 'Zil2'); await q.click('#joinForm button[type=submit]'); await bekle(600);
    const uid2 = S.hesaplar.get('zil2@test.dev').id;
    // önce izin penceresi kapatılır (karar verilmez): sessiz kalır, pencere açılır, düğme orada
    await q.click('#timerCard .bell'); await q.waitForSelector('#alForm'); await bekle(400);
    ok('Zile ilk basışta izin soruluyor', await q.evaluate(() => window.__izinSoruldu === 1));
    ok('İzin penceresi kapatılınca hata yazısı çıkmıyor, zil penceresi açık', (await q.$$('#alForm')).length === 1 && !(await q.isVisible('#toast')));
    await q.click('#alForm [data-close-modal]');
    // ikinci basışta izin verilir: cihaz hemen kaydolur, pencerede "Bildirimler açık."
    await ctx2.grantPermissions(['notifications'], { origin: S.adres });
    await q.evaluate(() => localStorage.setItem('izin.ver', '1'));
    await q.click('#timerCard .bell'); await q.waitForSelector('#alForm'); await bekle(1200);
    ok('İzin verilince ayrı düğmeye basmadan cihaz kaydoldu', (await S.sql('select 1 from push_abonelikleri where uid = $1', [uid2])).length === 1);
    const notMetni = await q.evaluate(() => ({ not: document.querySelector('#alNote') && document.querySelector('#alNote').textContent.trim(), durum: window.TusAltyapi.bildirim.durum(), kayitli: window.TusAltyapi.bildirim.kayitli, izin: Notification.permission }));
    ok('Zil penceresi kendiliğinden "Bildirimler açık." oldu', notMetni.not.includes('Bildirimler açık'), JSON.stringify(notMetni));
    await q.click('#alForm [data-close-modal]');
    const once = await q.evaluate(() => window.__izinSoruldu);
    await q.click('#timerCard .bell'); await q.waitForSelector('#alForm'); await bekle(300);
    ok('Bildirim açıkken zile basınca bir daha izin sorulmuyor', await q.evaluate(n => window.__izinSoruldu === n, once));
    ok('Sayfa hatası yok', hatalar.length === 0, hatalar.join(' | '));
  } catch (e) { ok('Test akışı tamamlandı', false, (e && e.stack) || String(e)); }
  console.log(out.join('\n'));
  console.log(`\n${out.filter(x => x.startsWith('GEÇTİ')).length} geçti, ${out.filter(x => x.startsWith('KALDI')).length} kaldı`);
  await b.close(); await S.kapat();
})();
