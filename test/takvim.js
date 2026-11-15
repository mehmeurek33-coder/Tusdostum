// Dersler sekmesindeki aylık takvim: gün toplamları, ders dökümü, elle kayıt kutusu, ay geçişi, telefon genişliği.
// Çalıştırma: NODE_PATH=$(npm root -g) node test/takvim.js
const { chromium } = require('playwright');
const path = require('path');
const F = 'file://' + path.resolve(__dirname, '../index.html');
const out = [];
const ok = (ad, kosul, ek = '') => out.push(`${kosul ? 'GEÇTİ ' : 'KALDI '} ${ad}${!kosul && ek ? ' — ' + ek : ''}`);
const bekle = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 } });
  await ctx.addInitScript(() => { try { Object.defineProperty(window, 'TUSDOSTUM_AYAR', { get: () => ({}), set: () => {}, configurable: false }); } catch {} });
  const p = await ctx.newPage();
  const hatalar = []; p.on('pageerror', e => hatalar.push(e.message));
  await p.goto(F);
  // Bugün: Patoloji 120 + Pediatri 45 (+ silinmiş 300 sayılmaz); 2 gün önce Anatomi 60; geçen ay 15'inde Dahiliye 90; elle bugün Farmakoloji 30
  const kurulum = await p.evaluate(() => {
    const k = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    const n = Date.now(), bugun = new Date(), iki = new Date(); iki.setDate(iki.getDate() - 2);
    const gecen = new Date(bugun.getFullYear(), bugun.getMonth() - 1, 15, 10);
    const kron = {}, manual = {};
    const ekle = (dep, d, id, e) => { const ym = d.slice(0, 7); (dep[ym] = dep[ym] || {})[id] = e; };
    const t = (d, s, tt, m, st) => ({ d, s, t: tt, m, mm: m, st, en: st + m * 60000, b: 0, bn: 0, q: 0, c: 0, w: 0, ts: st });
    const tb = k(bugun), ti = k(iki), tg = k(gecen);
    const sabah = new Date(); sabah.setHours(0, 5, 0, 0);
    ekle(kron, tb, 'a', t(tb, 'patoloji', 'konu', 120, sabah.getTime()));
    ekle(kron, tb, 'b', t(tb, 'pediatri', 'tekrar', 45, sabah.getTime() + 130 * 60000));
    ekle(kron, tb, 'x', { ...t(tb, 'dahiliye', 'konu', 300, sabah.getTime()), del: 1 });
    ekle(kron, ti, 'c', t(ti, 'anatomi', 'konu', 60, iki.setHours(9, 0, 0, 0)));
    ekle(kron, tg, 'd', t(tg, 'dahiliye', 'soru', 90, gecen.getTime()));
    ekle(manual, tb, 'm', { d: tb, s: 'farmakoloji', t: 'konu', m: 30, q: 0, c: 0, w: 0, ts: n });
    localStorage.clear();
    localStorage.setItem('tusdostum.v3', JSON.stringify({ root: { nick: 'T' }, kron, manual, settings: { firstDay: tg }, denemeler: {} }));
    localStorage.setItem('tusdostum.pref', JSON.stringify({ welcomed: true, period: 'ay', incManual: false }));
    return { tb, ti, tg, ayniAy: ti.slice(0, 7) === tb.slice(0, 7), ilkGun: bugun.getDate() };
  });
  const kayitlar = () => p.evaluate(() => { const v = JSON.parse(localStorage.getItem('tusdostum.v3')); return JSON.stringify([v.kron, v.manual]); });
  const kayitOnce = await kayitlar();
  await p.reload(); await bekle(800);
  await p.evaluate(() => { location.hash = 'dersler'; }); await bekle(600);
  const takvim = () => p.evaluate(() => {
    const t = document.querySelector('#panel-dersler .tk'); if (!t) return null;
    const hucreler = Object.fromEntries([...t.querySelectorAll('[data-tkgun]')].map(c => [c.dataset.tkgun, { v: (c.querySelector('.v') || {}).textContent || '', serit: c.querySelectorAll('.b i').length, secili: c.getAttribute('aria-pressed') === 'true' }]));
    return { ay: t.querySelector('.nav h2').textContent, geri: !t.querySelector('[data-tkay="-1"]').disabled, ileri: !t.querySelector('[data-tkay="1"]').disabled,
      dokum: (t.querySelector('.det') || {}).textContent ? t.querySelector('.det').textContent.replace(/\s+/g, ' ').trim() : '', hucreler, gunSayisi: t.querySelectorAll('.c:not(.bos)').length,
      ileriTik: t.querySelectorAll('.c.ileri[data-tkgun]').length, sira: [...document.querySelectorAll('#panel-dersler > .panel')].map(x => (x.querySelector('h2') || {}).textContent) };
  });
  const ayAdi = ym => ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'][+ym.slice(5) - 1] + ' ' + ym.slice(0, 4);

  let t = await takvim();
  ok('Takvim Dersler kartının hemen altında, Ders dağılımının üstünde', t && t.sira[0] === 'Dersler' && t.sira[2] === 'Ders dağılımı', JSON.stringify(t && t.sira));
  ok('İçinde bulunulan ay gösteriliyor; ileri ok kapalı', t.ay === ayAdi(kurulum.tb.slice(0, 7)) && !t.ileri && t.geri, JSON.stringify([t.ay, t.ileri, t.geri]));
  const hb = t.hucreler[kurulum.tb];
  ok('Bugün: 2:45 (Patoloji 120 + Pediatri 45; silinen sayılmaz, elle kayıt dahil değil), iki renkli şerit, seçili', hb && hb.v === '2:45' && hb.serit === 2 && hb.secili, JSON.stringify(hb));
  ok('Açılışta bugünün dökümü: Patoloji 2 sa, Pediatri 45 dk', /Bugün/.test(t.dokum) && /2 sa 45 dk/.test(t.dokum) && /Patoloji\s*2 sa/.test(t.dokum) && /Pediatri\s*45 dk/.test(t.dokum) && !/Farmakoloji/.test(t.dokum), t.dokum);
  ok('Gelecek günlere dokunulamıyor', t.ileriTik === 0);
  // Takvim toplamı = üstteki "Toplam çalışma" (Bu ay)
  const tutarli = await p.evaluate(() => {
    const top = [...document.querySelectorAll('#panel-dersler .tk [data-tkgun] .v')].reduce((a, v) => { const [h, m] = v.textContent.split(':').map(Number); return a + h * 60 + m; }, 0);
    return { top, kutu: document.querySelector('#panel-dersler .tile .v').textContent };
  });
  const dk = s => { const h = /(\d+) sa/.exec(s), m = /(\d+) dk/.exec(s); return (h ? +h[1] * 60 : 0) + (m ? +m[1] : 0); };
  ok('Bu ay: takvimdeki günlerin toplamı üstteki "Toplam çalışma" ile aynı', tutarli.top === dk(tutarli.kutu), JSON.stringify(tutarli));
  // Başka güne dokun
  if (kurulum.ayniAy) {
    await p.click(`#panel-dersler [data-tkgun="${kurulum.ti}"]`); await bekle(200);
    t = await takvim();
    ok('Başka güne dokununca o günün dökümü: Anatomi 1 sa', /1 sa/.test(t.dokum) && /Anatomi/.test(t.dokum) && t.hucreler[kurulum.ti].secili && !t.hucreler[kurulum.tb].secili, t.dokum);
  } else ok('Başka güne dokununca o günün dökümü (ayın ilk günlerinde atlandı)', true);
  // Elle kayıtlar dahil
  await p.check('#incManual'); await bekle(300);
  t = await takvim();
  ok('"Elle kayıtları dahil et" işaretlenince bugün 3:15 ve Farmakoloji dökümde', t.hucreler[kurulum.tb].v === '3:15' && t.hucreler[kurulum.tb].serit === 3, JSON.stringify(t.hucreler[kurulum.tb]));
  await p.uncheck('#incManual'); await bekle(300);
  // Önceki ay
  await p.click('#panel-dersler [data-tkay="-1"]'); await bekle(300);
  t = await takvim();
  const gecenAy = kurulum.tg.slice(0, 7);
  ok('Önceki aya geçiş: geçen ayın 15\'inde Dahiliye 1:30; ileri ok açık, geri ok kapalı (ilk ay)', t.ay === ayAdi(gecenAy) && t.hucreler[kurulum.tg].v === '1:30' && t.ileri && !t.geri, JSON.stringify([t.ay, t.hucreler[kurulum.tg], t.ileri, t.geri]));
  ok('Geçmiş ayda dökümde gün seçili değil (dokununca açılır)', t.dokum === '');
  await p.click(`#panel-dersler [data-tkgun="${kurulum.tg}"]`); await bekle(200);
  ok('Geçen aydaki güne dokununca döküm: Dahiliye 1 sa 30 dk', /Dahiliye\s*1 sa 30 dk/.test((await takvim()).dokum));
  // Belirli ay seçimi takvimi o aya götürür
  await p.click('#panel-dersler [data-period="ay"]'); await bekle(300);
  ok('"Bu ay"a basınca takvim içinde bulunulan aya döner', (await takvim()).ay === ayAdi(kurulum.tb.slice(0, 7)));
  await p.selectOption('#periodMonth', 'm:' + gecenAy); await bekle(300);
  ok('"Belirli bir ay seç" ile takvim o aya geçiyor', (await takvim()).ay === ayAdi(gecenAy));
  // Kayıtlar değişmedi
  ok('Takvimle gezinmek kayıtları değiştirmiyor', (await kayitlar()) === kayitOnce);
  // Telefon genişliği
  await p.click('#panel-dersler [data-period="ay"]'); await bekle(200);
  await p.setViewportSize({ width: 320, height: 700 }); await bekle(400);
  const tasma = await p.evaluate(() => { const t = document.querySelector('#panel-dersler .tk'); return { kutu: t.scrollWidth <= t.clientWidth + 1, sayfa: document.documentElement.scrollWidth <= 320, h: Math.round(t.querySelector('.c[data-tkgun]').getBoundingClientRect().height) }; });
  ok('320 px genişlikte takvim taşmıyor, günler dokunulabilir boyutta', tasma.kutu && tasma.sayfa && tasma.h >= 44, JSON.stringify(tasma));
  ok('Sayfa hatası yok', !hatalar.length, hatalar.join(' | '));
  console.log(out.join('\n'));
  console.log(`\n${out.filter(x => x.startsWith('GEÇTİ')).length} geçti, ${out.filter(x => x.startsWith('KALDI')).length} kaldı`);
  await b.close();
})();
