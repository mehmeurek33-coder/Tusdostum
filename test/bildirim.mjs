// Bildirim gönderici testi: şifreleme bağımsız bir kütüphaneyle (http_ece) çözülür, VAPID imzası Node'un crypto'suyla doğrulanır.
// Çalıştırma:  NODE_PATH=<http_ece modülünün olduğu node_modules> node test/bildirim.mjs
import fs from 'node:fs'; import path from 'node:path'; import os from 'node:os'; import crypto from 'node:crypto';
import { createRequire } from 'node:module'; import { fileURLToPath, pathToFileURL } from 'node:url';
const require = createRequire(import.meta.url);
const ece = require('http_ece');
const BURASI = path.dirname(fileURLToPath(import.meta.url));

// index.ts düz JavaScript'e çok yakın; tek tür ifadesi çıkarılıp geçici bir modül olarak içe alınır
const kaynak = fs.readFileSync(path.join(BURASI, '../supabase/functions/uyari-gonder/index.ts'), 'utf8').replace('(globalThis as any)', '(globalThis)');
const gecici = path.join(os.tmpdir(), `td-uyari-${process.pid}.mjs`);
fs.writeFileSync(gecici, kaynak);
const { sifrele, vapidYetki, calistir, sunucuAnahtari } = await import(pathToFileURL(gecici).href);

const out = [];
const ok = (ad, kosul, ek = '') => out.push(`${kosul ? 'GEÇTİ ' : 'KALDI '} ${ad}${!kosul && ek ? ' — ' + ek : ''}`);
const b64u = b => Buffer.from(b).toString('base64url');

// Alıcı (telefon) tarafı: anahtar çifti + gizli değer
const alici = crypto.createECDH('prime256v1'); alici.generateKeys();
const auth = crypto.randomBytes(16);
const abone = { endpoint: 'https://push.ornek.dev/gonder/abc123', p256dh: b64u(alici.getPublicKey()), auth: b64u(auth) };
const coz = govde => ece.decrypt(Buffer.from(govde), { version: 'aes128gcm', privateKey: alici, authSecret: auth }).toString('utf8');

// 1) Şifreleme
const metin = JSON.stringify({ baslik: '⏰ Mola bitti!', govde: 'Molan 10 dakikayı geçti. ğüşiöç' });
const govde = await sifrele(new TextEncoder().encode(metin), abone.p256dh, abone.auth);
let cozulen = '';
try { cozulen = coz(govde); } catch (e) { cozulen = 'HATA: ' + e.message; }
ok('Şifreli ileti bağımsız kütüphaneyle çözülüyor (RFC 8291)', cozulen === metin, cozulen);
const govde2 = await sifrele(new TextEncoder().encode(metin), abone.p256dh, abone.auth);
ok('Her gönderimde farklı şifreli metin (rastgele tuz ve anahtar)', b64u(govde) !== b64u(govde2));

// 2) VAPID: anahtar.html ile aynı yöntemle üretilen anahtar çifti
const k = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
const vapid = { acik: b64u(await crypto.subtle.exportKey('raw', k.publicKey)), ozel: (await crypto.subtle.exportKey('jwk', k.privateKey)).d, konu: 'mailto:test@ornek.dev' };
const simdi = Date.now();
const yetki = await vapidYetki(abone.endpoint, vapid, simdi);
const m = /^vapid t=([\w-]+)\.([\w-]+)\.([\w-]+), k=([\w-]+)$/.exec(yetki);
ok('VAPID başlığı biçimi doğru', !!m && m[4] === vapid.acik, yetki);
if (m) {
  const dogru = crypto.verify('sha256', Buffer.from(`${m[1]}.${m[2]}`), { key: k.publicKey, dsaEncoding: 'ieee-p1363' }, Buffer.from(m[3], 'base64url'));
  ok('VAPID imzası açık anahtarla doğrulanıyor (ES256)', dogru);
  const bas = JSON.parse(Buffer.from(m[1], 'base64url')), yuk = JSON.parse(Buffer.from(m[2], 'base64url'));
  ok('VAPID içeriği: alıcı servis, süre (≤24 saat), iletişim', bas.alg === 'ES256' && yuk.aud === 'https://push.ornek.dev' && yuk.sub === vapid.konu && yuk.exp > simdi / 1000 && yuk.exp - simdi / 1000 <= 24 * 3600, JSON.stringify([bas, yuk]));
}

// 3) Bütün akış: kuyruk → gönder → ölü aboneliği sil (ağ ve veritabanı taklit edilir)
const istekler = [];
const sahteFetch = async (url, secenek) => {
  istekler.push({ url, secenek });
  if (url.endsWith('/rest/v1/rpc/td_vadesi_gelenler')) return new Response(JSON.stringify([
    { uid: 'u1', tur: 'mola', dk: 10, ...abone },
    { uid: 'u1', tur: 'calisma', dk: 45, ...abone, endpoint: 'https://push.ornek.dev/gonder/olu' },
    { uid: 'u2', tur: 'sinir', dk: 180, ...abone, endpoint: 'https://push.ornek.dev/gonder/hata' },
  ]), { status: 200 });
  if (url.endsWith('/rest/v1/rpc/td_olu_abonelikleri_sil')) return new Response('null', { status: 200 });
  if (url.endsWith('/olu')) return new Response('', { status: 410 });
  if (url.endsWith('/hata')) return new Response('', { status: 500 });
  return new Response('', { status: 201 });
};
const sonuc = await calistir({ url: 'https://proje.supabase.co', anahtar: 'servis-anahtari', vapid }, sahteFetch);
ok('Sonuç sayıları: 1 gönderildi, 2 başarısız, 1 ölü abonelik silindi', sonuc.gonderilen === 1 && sonuc.basarisiz === 2 && sonuc.silinen === 1, JSON.stringify(sonuc));
const kuyruk = istekler.find(x => x.url.endsWith('td_vadesi_gelenler'));
ok('Kuyruk sunucu anahtarıyla okunuyor; yeni tür anahtar Authorization başlığına konmuyor', kuyruk && kuyruk.secenek.headers.apikey === 'servis-anahtari' && !('Authorization' in kuyruk.secenek.headers));
const eski = [];
await calistir({ url: 'https://proje.supabase.co', anahtar: 'eyJhbGciOi.eski.tur', vapid }, async (url, s) => { eski.push(s); return new Response('[]', { status: 200 }); });
ok('Eski tür (JWT) anahtar Authorization başlığıyla da gidiyor', eski[0].headers.Authorization === 'Bearer eyJhbGciOi.eski.tur');
const ortam = o => ad => o[ad];
ok('Sunucu anahtarı seçimi: elle verilen > yeni tür > eski tür',
  sunucuAnahtari(ortam({ SERVIS_ANAHTARI: ' elle ', SUPABASE_SECRET_KEYS: '{"default":"sb_secret_x"}' })) === 'elle' &&
  sunucuAnahtari(ortam({ SUPABASE_SECRET_KEYS: '{"default":"sb_secret_x"}', SUPABASE_SERVICE_ROLE_KEY: 'eyJ' })) === 'sb_secret_x' &&
  sunucuAnahtari(ortam({ SUPABASE_SECRET_KEYS: '[{"name":"diger","api_key":"sb_secret_a"},{"name":"default","api_key":"sb_secret_b"}]' })) === 'sb_secret_b' &&
  sunucuAnahtari(ortam({ SUPABASE_SECRET_KEYS: 'sb_secret_duz' })) === 'sb_secret_duz' &&
  sunucuAnahtari(ortam({ SUPABASE_SERVICE_ROLE_KEY: 'eyJeski' })) === 'eyJeski');
const giden = istekler.find(x => x.url === abone.endpoint);
const h = giden && giden.secenek.headers;
ok('Bildirim isteği başlıkları (aes128gcm, TTL, VAPID)', !!h && h['Content-Encoding'] === 'aes128gcm' && h.TTL === '600' && /^vapid t=/.test(h.Authorization), JSON.stringify(h));
const ileti = giden ? JSON.parse(coz(giden.secenek.body)) : {};
ok('Telefona giden ileti: başlık, metin, etiket', ileti.baslik === '⏰ Mola bitti!' && ileti.govde === 'Molan 10 dakikayı geçti. Çalışmaya dön.' && ileti.etiket === 'td-mola-0', JSON.stringify(ileti));
const { METIN } = await import(pathToFileURL(gecici).href);
ok('Tekrarlarda geçen süre büyüyor (5, 8, 11 dk)', [0, 1, 2].map(i => METIN.mola(5, i).govde).join('|') === 'Molan 5 dakikayı geçti. Çalışmaya dön.|Molan 8 dakikayı geçti. Çalışmaya dön.|Molan 11 dakikayı geçti. Çalışmaya dön.');
const sil = istekler.find(x => x.url.endsWith('td_olu_abonelikleri_sil'));
ok('Yalnızca 404/410 dönen abonelik siliniyor (500 dönen kalıyor)', sil && JSON.stringify(JSON.parse(sil.secenek.body).p_endpointler) === JSON.stringify(['https://push.ornek.dev/gonder/olu']), sil && sil.secenek.body);

fs.unlinkSync(gecici);
console.log(out.join('\n'));
console.log(`\n${out.filter(x => x.startsWith('GEÇTİ')).length} geçti, ${out.filter(x => x.startsWith('KALDI')).length} kaldı`);
