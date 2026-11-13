// CANLI test: uygulamayı GERÇEK Supabase projesine (config.js) karşı tarayıcıda dener.
// Geçici hesaplar açar ve sonunda siler. Denetimler ve temizlik Supabase Management API ile yapılır
// (erişim anahtarı bu ortamın ağ vekili tarafından eklenir; kodda anahtar yok).
// Çalıştırma:  REF=<proje kimliği> NODE_PATH="$(npm root -g)" node test/canli-supabase.js
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path'), { execFileSync } = require('child_process');

const KOK = path.resolve(__dirname, '..');
const REF = process.env.REF;
if (!REF) { console.error('REF gerekli'); process.exit(2); }
const out = [];
const ok = (ad, kosul, ek = '') => out.push(`${kosul ? 'GEÇTİ ' : 'KALDI '} ${ad}${!kosul && ek ? ' — ' + ek : ''}`);
const bekle = ms => new Promise(r => setTimeout(r, ms));
const sql = q => JSON.parse(execFileSync('curl', ['-sS', '--max-time', '60', '-X', 'POST', `https://api.supabase.com/v1/projects/${REF}/database/query`,
  '-H', 'Content-Type: application/json', '--data-binary', JSON.stringify({ query: q })]).toString());
const TIP = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.webmanifest': 'application/manifest+json', '.png': 'image/png' };

(async () => {
  const sunucu = http.createServer((req, res) => {
    let yol = decodeURIComponent(new URL(req.url, 'http://x').pathname); if (yol === '/') yol = '/index.html';
    const d = path.join(KOK, yol);
    if (!d.startsWith(KOK) || !fs.existsSync(d) || fs.statSync(d).isDirectory()) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'content-type': TIP[path.extname(d)] || 'application/octet-stream', 'cache-control': 'no-store' }); res.end(fs.readFileSync(d));
  });
  await new Promise(r => sunucu.listen(0, '127.0.0.1', r));
  const ADRES = `http://localhost:${sunucu.address().port}`;
  const ek = Date.now().toString(36);
  const mail = h => `tdcanli-${h}-${ek}@example.com`;
  const b = await chromium.launch({ proxy: process.env.HTTPS_PROXY ? { server: process.env.HTTPS_PROXY, bypass: 'localhost,127.0.0.1' } : undefined });
  const hatalar = [];
  const kisi = async () => {
    const ctx = await b.newContext({ viewport: { width: 390, height: 780 }, hasTouch: true, ignoreHTTPSErrors: true, serviceWorkers: 'block' });
    const p = await ctx.newPage();
    p.on('pageerror', e => hatalar.push(e.message));
    await p.goto(ADRES + '/');
    return p;
  };
  const kayit = async (p, m, ad) => {
    await p.waitForSelector('#authView', { timeout: 20000 });
    await p.click('#authView [data-mode="kayit"]'); await p.fill('#aMail', m); await p.fill('#aPass', 'Gizli-12345'); await p.click('#aGo');
    await p.waitForSelector('#joinForm', { timeout: 25000 });
    await p.fill('#jNick', ad); await p.click('#joinForm button[type=submit]'); await bekle(1500);
    await p.evaluate(() => { location.hash = 'salon'; }); await bekle(1200);
  };
  const odaDene = async (p, tur, ad) => {
    await p.click(tur === 'kur' ? '[data-room-new]' : '[data-room-join]'); await p.waitForSelector('#roomForm');
    await p.fill('#rName', ad); await p.click('#roomForm button[type=submit]');
    for (let i = 0; i < 40; i++) { await bekle(150); if (!(await p.$('#roomForm')) || (await p.textContent('#rErr')).trim()) break; }
    const acik = !!(await p.$('#roomForm')), h = acik ? (await p.textContent('#rErr')).trim() : '';
    if (acik) await p.click('#roomForm [data-close-modal]');
    return h;
  };
  const satir = (p, ad) => p.evaluate(ad => { const r = [...document.querySelectorAll('#onlinePanel .person')].find(x => x.textContent.includes(ad)); return r ? { metin: r.textContent.replace(/\s+/g, ' ').trim(), dugme: r.tagName === 'BUTTON' } : null; }, ad);
  const uid = m => (sql(`select id from auth.users where email = '${m}'`)[0] || {}).id;
  const oda = `Canlı Deneme ${ek}`;
  try {
    const A = await kisi();
    await kayit(A, mail('a'), 'Deneme A');
    const ua = uid(mail('a'));
    ok('Gerçek projede kayıt oldu (e-posta onayı istenmedi)', !!ua && !(await A.$('#authView')));
    ok('Profil satırı sunucuda', sql(`select veri->>'nick' as n from public.profiller where uid = '${ua}'`)[0]?.n === 'Deneme A');
    ok('Uydurma odaya katılınamıyor', (await odaDene(A, 'katil', 'Uydurma ' + ek)) === 'Böyle bir oda yok.');
    ok('Oda kuruldu', (await odaDene(A, 'kur', oda)) === '' && sql(`select count(*)::int as n from public.oda_uyeleri where uid = '${ua}'`)[0].n === 1);
    await A.evaluate(() => { location.hash = 'bugun'; }); await bekle(500);
    await A.click('[data-act="manual"]'); await A.waitForSelector('#entryForm'); await A.fill('#fM', '25'); await A.click('#entryForm button[type=submit]'); await bekle(2000);
    ok('Elle kayıt özel alana yazıldı', sql(`select count(*)::int as n from public.ozel_belgeler where uid = '${ua}' and belge like 'elle-%'`)[0].n === 1);
    await A.click('#timerCard .bell'); await A.waitForSelector('#alForm'); await A.click('[data-chips="workWarn"] button[data-v="45"]'); await A.click('#alForm [data-close-modal]');
    await A.click('[data-act="start"]'); await bekle(2500);
    const u = sql(`select tur, dk from public.uyarilar where uid = '${ua}' order by tur`);
    ok('Kronometre başlayınca uyarılar sunucuda (45 dk + 3 saat)', u.length === 2 && u[0].tur === 'calisma' && u[0].dk === 45 && u[1].tur === 'sinir', JSON.stringify(u));

    const B = await kisi();
    await kayit(B, mail('b'), 'Deneme B');
    ok('Var olan adla oda kurulamıyor', (await odaDene(B, 'kur', oda.toUpperCase())) === 'Bu adda bir oda var.');
    ok('Odaya katıldı', (await odaDene(B, 'katil', oda.toLowerCase())) === '');
    let sa = null;
    for (let i = 0; i < 30; i++) { await bekle(500); sa = await satir(B, 'Deneme A'); if (sa && /Çalışıyor|Anatomi|Konu/.test(sa.metin)) break; }
    ok('B, odada A\'yı çalışırken görüyor (canlı bağlantı)', !!sa && /Anatomi|Konu|Çalışıyor/.test(sa.metin) && sa.dugme, JSON.stringify(sa));
    await A.click('[data-act="pause"]');
    let mola = false;
    for (let i = 0; i < 30 && !mola; i++) { await bekle(500); const r = await satir(B, 'Deneme A'); mola = !!r && /Molada/.test(r.metin); }
    ok('A mola verince B anında "Molada" görüyor', mola);

    const C = await kisi();
    await kayit(C, mail('c'), 'Deneme C');
    const sc = await satir(C, 'Deneme A');
    ok('Genel\'de A görünüyor ama profili açılmıyor', !!sc && !sc.dugme, JSON.stringify(sc));
    const sizinti = await C.evaluate(async (ua) => {
      const cfg = window.TUSDOSTUM_AYAR, oturum = JSON.parse(Object.entries(localStorage).find(([k]) => k.startsWith('sb-'))[1]);
      const h = { apikey: cfg.supabaseAnahtar, Authorization: 'Bearer ' + oturum.access_token };
      const al = async t => (await (await fetch(`${cfg.supabaseUrl}/rest/v1/${t}?uid=eq.${ua}&select=*`, { headers: h })).json());
      return { ozel: await al('ozel_belgeler'), son: await al('son_gunler'), odalar: await al('odalarim') };
    }, ua);
    ok('Sunucu, C\'ye A\'nın özel kayıtlarını, son 10 gününü ve oda adlarını VERMİYOR', Array.isArray(sizinti.ozel) && !sizinti.ozel.length && !sizinti.son.length && !sizinti.odalar.length, JSON.stringify(sizinti).slice(0, 300));

    await A.reload(); await bekle(4000);
    ok('Yenileyince oturum, kronometre ve kayıt duruyor', !(await A.$('#authView')) && await A.evaluate(() => /Molada/.test(document.querySelector('#timerCard').textContent)));
    ok('Sayfa hatası yok', hatalar.length === 0, hatalar.join(' | '));
  } catch (e) {
    ok('Test akışı tamamlandı', false, (e && e.stack) || String(e));
  } finally {
    await b.close(); sunucu.close();
    const sil = sql(`delete from auth.users where email like 'tdcanli-%-${ek}@example.com' returning id`);
    const kalan = sql(`select (select count(*) from auth.users where email like 'tdcanli-%')::int as kullanici, (select count(*) from public.profiller)::int as profil, (select count(*) from public.oda_uyeleri)::int as oda, (select count(*) from public.uyarilar)::int as uyari`)[0];
    out.push(`Temizlik: ${sil.length} deneme hesabı silindi; kalan → ${JSON.stringify(kalan)}`);
  }
  console.log(out.join('\n'));
  console.log(`\n${out.filter(x => x.startsWith('GEÇTİ')).length} geçti, ${out.filter(x => x.startsWith('KALDI')).length} kaldı`);
})();
