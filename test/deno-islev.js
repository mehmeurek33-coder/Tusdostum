// Bildirim göndericiyi gerçek Deno çalışma zamanında (Supabase Edge Functions'ın kullandığı) çalıştırır.
// Veritabanı ve bildirim servisi yerel bir sunucuyla taklit edilir.
// Çalıştırma:  DENO=<deno yolu> NODE_PATH=<http_ece'nin olduğu node_modules> node test/deno-islev.js
const http = require('http'), path = require('path'), crypto = require('crypto'), { spawn } = require('child_process');
const ece = require('http_ece');
const out = [];
const ok = (ad, kosul, ek = '') => out.push(`${kosul ? 'GEÇTİ ' : 'KALDI '} ${ad}${!kosul && ek ? ' — ' + ek : ''}`);
const b64u = b => Buffer.from(b).toString('base64url');

(async () => {
  const alici = crypto.createECDH('prime256v1'); alici.generateKeys();
  const auth = crypto.randomBytes(16);
  const k = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const vapidAcik = b64u(await crypto.subtle.exportKey('raw', k.publicKey)), vapidOzel = (await crypto.subtle.exportKey('jwk', k.privateKey)).d;
  const gelen = [];
  const sunucu = http.createServer((req, res) => {
    const parca = [];
    req.on('data', d => parca.push(d));
    req.on('end', () => {
      const govde = Buffer.concat(parca);
      gelen.push({ url: req.url, basliklar: req.headers, govde });
      if (req.url === '/rest/v1/rpc/td_vadesi_gelenler') {
        res.writeHead(200, { 'content-type': 'application/json' });
        return res.end(JSON.stringify([{ uid: 'u1', tur: 'calisma', dk: 45, endpoint: `http://127.0.0.1:${sunucu.address().port}/push/1`, p256dh: b64u(alici.getPublicKey()), auth: b64u(auth) }]));
      }
      res.writeHead(req.url.startsWith('/push/') ? 201 : 200); res.end('null');
    });
  });
  await new Promise(r => sunucu.listen(0, '127.0.0.1', r));
  const port = sunucu.address().port;
  const deno = spawn(process.env.DENO || 'deno', ['run', '--allow-net', '--allow-env', '--no-prompt', path.resolve(__dirname, '../supabase/functions/uyari-gonder/index.ts')], {
    env: { ...process.env, SUPABASE_URL: `http://127.0.0.1:${port}`, SUPABASE_SERVICE_ROLE_KEY: 'servis', CRON_GIZLI: 'cok-gizli', VAPID_ACIK: vapidAcik, VAPID_OZEL: vapidOzel, VAPID_KONU: 'mailto:test@ornek.dev', NO_COLOR: '1' },
  });
  let gunluk = '';
  deno.stdout.on('data', d => { gunluk += d; }); deno.stderr.on('data', d => { gunluk += d; });
  try {
    let hazir = false;
    for (let i = 0; i < 150 && !hazir; i++) { await new Promise(r => setTimeout(r, 200)); try { await fetch('http://127.0.0.1:8000/'); hazir = true; } catch {} }
    ok('İşlev Deno üzerinde açılıyor', hazir, gunluk.slice(-400));
    if (hazir) {
      const r1 = await fetch('http://127.0.0.1:8000/', { method: 'POST' });
      ok('Gizli değer olmadan çağrı reddediliyor (401)', r1.status === 401);
      const r2 = await fetch('http://127.0.0.1:8000/', { method: 'POST', headers: { 'x-cron-gizli': 'yanlis' } });
      ok('Yanlış gizli değer reddediliyor (401)', r2.status === 401);
      ok('Yetkisiz çağrıda veritabanına gidilmiyor', gelen.length === 0);
      const r3 = await fetch('http://127.0.0.1:8000/', { method: 'POST', headers: { 'x-cron-gizli': 'cok-gizli' } });
      const j = r3.status === 200 ? await r3.json() : await r3.text();
      ok('Doğru gizli değerle çalışıyor: 1 bildirim gönderildi', r3.status === 200 && j.gonderilen === 1 && j.basarisiz === 0, JSON.stringify(j));
      const p = gelen.find(x => x.url === '/push/1');
      let ileti = {};
      try { ileti = JSON.parse(ece.decrypt(p.govde, { version: 'aes128gcm', privateKey: alici, authSecret: auth }).toString('utf8')); } catch (e) { ileti = { hata: e.message }; }
      ok('Deno\'nun şifrelediği ileti telefonda çözülebiliyor', ileti.govde === 'Aralıksız çalışman 45 dakikayı geçti.' && ileti.etiket === 'td-calisma', JSON.stringify(ileti));
      const m = /^vapid t=([\w-]+)\.([\w-]+)\.([\w-]+), k=/.exec((p && p.basliklar.authorization) || '');
      ok('Deno\'nun attığı VAPID imzası doğrulanıyor', !!m && crypto.verify('sha256', Buffer.from(`${m[1]}.${m[2]}`), { key: k.publicKey, dsaEncoding: 'ieee-p1363' }, Buffer.from(m[3], 'base64url')));
    }
  } finally { deno.kill(); sunucu.close(); }
  console.log(out.join('\n'));
  console.log(`\n${out.filter(x => x.startsWith('GEÇTİ')).length} geçti, ${out.filter(x => x.startsWith('KALDI')).length} kaldı`);
})();
