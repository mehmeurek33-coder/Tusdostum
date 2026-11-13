// TEST İÇİN küçük bir Supabase taklidi.
//  - Uygulama dosyalarını http://localhost:PORT/ üzerinden sunar.
//  - vendor/supabase.js yerine sahte bir istemci verir; istemci bu sunucuya konuşur.
//  - Sorgular GERÇEK PostgreSQL'de, "authenticated" rolüyle ve satır düzeyi güvenlik açıkken çalışır
//    (supabase/schema.sql aynen yüklenir). Böylece altyapi.js ile şemanın uyumu ve gizlilik kuralları birlikte denenir.
const http = require('http'), fs = require('fs'), path = require('path'), crypto = require('crypto');
const { Client, Pool } = require('pg');

const KOK = path.resolve(__dirname, '..');
const PG = { host: '127.0.0.1', port: 5432, user: 'postgres', password: process.env.PGPASSWORD || 'test' };
const DB = 'tdtest_e2e';
const PK = { profiller: ['uid'], son_gunler: ['uid'], ozel_belgeler: ['uid', 'belge'] };
const JSONB_SUTUN = new Set(['veri', 'son']);
const JSONB_ARG = { td_profil_guncelle: ['p_yama'], td_ozel_guncelle: ['p_yama'], td_ozel_birlestir: ['p_yama'], td_uyarilari_ayarla: ['p'] };
const RPC_TABLO = { td_profil_guncelle: ['profiller'], td_ozel_guncelle: ['ozel_belgeler'], td_ozel_birlestir: ['ozel_belgeler'], td_odalari_ayarla: ['oda_uyeleri'], td_kisi_cikar: ['profiller', 'son_gunler', 'oda_uyeleri'] };
const AD = /^[a-z_][a-z0-9_]*$/;
const TIP = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.css': 'text/css' };

async function kur() {
  const c = new Client({ ...PG, database: 'postgres' });
  await c.connect();
  await c.query(`drop database if exists ${DB} with (force)`);
  await c.query(`create database ${DB}`);
  await c.end();
  const d = new Client({ ...PG, database: DB });
  await d.connect();
  await d.query('set client_min_messages = error');
  await d.query(fs.readFileSync(path.join(__dirname, 'sql/00-supabase-taklit.sql'), 'utf8'));
  await d.query(fs.readFileSync(path.join(KOK, 'supabase/schema.sql'), 'utf8'));
  await d.end();
}

// gercek: true → sayfa GERÇEK supabase-js ile çalışır; bu sunucu Auth / PostgREST / Realtime protokollerini konuşur
async function baslat(port = 0, { vapid = '', gercek = false, kok = KOK } = {}) {
  await kur();
  const pool = new Pool({ ...PG, database: DB, max: 8 });
  const hesaplar = new Map();          // eposta -> { id, sifre }
  const olaylar = [];                  // { n, table, uid }
  const varlik = new Map();            // kanal -> Map(anahtar -> { ref, payload })
  const pushlar = [];                  // sahte bildirim servisine gelen istekler
  let sayac = 0;
  let proto = null;
  const olay = (table, uid, belge) => { olaylar.push({ n: ++sayac, table, uid }); if (proto) proto.degisim(table, uid, belge).catch(() => {}); };

  async function sorgu(uid, is) {
    const c = await pool.connect();
    try {
      await c.query('begin');
      await c.query('set local role authenticated');
      await c.query(`select set_config('request.jwt.claim.sub', $1, true)`, [uid || '']);
      const r = await is(c);
      await c.query('commit');
      return { data: r, error: null };
    } catch (e) {
      try { await c.query('rollback'); } catch {}
      return { data: null, error: { message: e.message, code: e.code } };
    } finally { c.release(); }
  }
  const nerede = (filtre, bas = 1) => {
    const f = (filtre || []).filter(x => AD.test(x[0]));
    return { sql: f.length ? ' where ' + f.map((x, i) => `${x[0]} = $${bas + i}`).join(' and ') : '', deger: f.map(x => x[1]) };
  };
  async function api(b) {
    const { uid, kind, table, fn } = b;
    if (kind === 'rpc') {
      if (!AD.test(fn)) return { data: null, error: { message: 'bad fn' } };
      const adlar = Object.keys(b.args || {}).filter(k => AD.test(k));
      const deger = adlar.map(k => ((JSONB_ARG[fn] || []).includes(k) ? JSON.stringify(b.args[k]) : b.args[k]));
      const r = await sorgu(uid, async c => (await c.query(`select public.${fn}(${adlar.map((k, i) => `${k} => $${i + 1}`).join(', ')}) as r`, deger)).rows[0].r);
      if (!r.error) (RPC_TABLO[fn] || []).forEach(t => olay(t, fn === 'td_kisi_cikar' ? b.args.p_uid : uid, (b.args || {}).p_belge));
      return r;
    }
    if (!AD.test(table)) return { data: null, error: { message: 'bad table' } };
    if (kind === 'select') {
      const cols = String(b.cols || '*').split(',').map(x => x.trim()).filter(x => AD.test(x)).join(', ') || '*';
      const w = nerede(b.filters);
      return sorgu(uid, async c => (await c.query(`select ${cols} from public.${table}${w.sql}`, w.deger)).rows);
    }
    if (kind === 'upsert') {
      const cols = Object.keys(b.row).filter(k => AD.test(k)), pk = PK[table] || [];
      const deger = cols.map(k => (JSONB_SUTUN.has(k) ? JSON.stringify(b.row[k]) : b.row[k]));
      const guncel = cols.filter(k => !pk.includes(k)).map(k => `${k} = excluded.${k}`).join(', ');
      const r = await sorgu(uid, async c => { await c.query(`insert into public.${table} (${cols.join(', ')}) values (${cols.map((_, i) => `$${i + 1}`).join(', ')}) on conflict (${pk.join(', ')}) do update set ${guncel}`, deger); return null; });
      if (!r.error) olay(table, b.row.uid, b.row.belge);
      return r;
    }
    if (kind === 'delete') {
      const w = nerede(b.filters);
      const r = await sorgu(uid, async c => { await c.query(`delete from public.${table}${w.sql}`, w.deger); return null; });
      if (!r.error) olay(table, uid, ((b.filters || []).find(x => x[0] === 'belge') || [])[1]);
      return r;
    }
    return { data: null, error: { message: 'bad kind' } };
  }
  function kimlik(b) {
    const eposta = String(b.email || '').toLowerCase();
    if (b.op === 'signUp') {
      if (hesaplar.has(eposta)) return { error: { message: 'User already registered' } };
      if (String(b.password || '').length < 6) return { error: { message: 'Password should be at least 6 characters' } };
      const id = crypto.randomUUID();
      hesaplar.set(eposta, { id, sifre: b.password });
      return pool.query('insert into auth.users (id, email) values ($1, $2)', [id, eposta]).then(() => ({ user: { id, email: eposta } }));
    }
    const h = hesaplar.get(eposta);
    if (!h || h.sifre !== b.password) return { error: { message: 'Invalid login credentials' } };
    return { user: { id: h.id, email: eposta } };
  }

  const sunucu = http.createServer(async (req, res) => {
    const u = new URL(req.url, 'http://x');
    const json = (o, kod = 200) => { if (kod === 204) { res.writeHead(204, { 'cache-control': 'no-store' }); return res.end(); } res.writeHead(kod, { 'content-type': 'application/json', 'cache-control': 'no-store' }); res.end(o === null && kod === 201 ? '' : JSON.stringify(o)); };
    try {
      // Gerçek supabase-js'in konuştuğu uçlar (kullanıcı olarak)
      if (u.pathname.startsWith('/auth/v1/') || (u.pathname.startsWith('/rest/v1/') && req.headers.apikey !== 'servis')) {
        let govde = '';
        for await (const p of req) govde += p;
        const b = govde ? JSON.parse(govde) : {};
        return u.pathname.startsWith('/auth/v1/') ? await proto.auth(req, u, b, json) : await proto.rest(req, u, b, json);
      }
      // Bildirim göndericinin (Edge Function) kullandığı REST çağrıları: service_role olarak çalışır
      if (u.pathname.startsWith('/rest/v1/rpc/')) {
        let govde = '';
        for await (const p of req) govde += p;
        const fn = u.pathname.split('/').pop(), args = govde ? JSON.parse(govde) : {};
        if (req.headers.apikey !== 'servis' || !AD.test(fn)) return json({ message: 'yetkisiz' }, 401);
        const adlar = Object.keys(args).filter(k => AD.test(k));
        const c = await pool.connect();
        try {
          await c.query('begin'); await c.query('set local role service_role');
          const r = await c.query(`select * from public.${fn}(${adlar.map((k, i) => `${k} => $${i + 1}`).join(', ')})`, adlar.map(k => args[k]));
          await c.query('commit');
          return json(fn === 'td_vadesi_gelenler' ? r.rows : null);
        } catch (e) { try { await c.query('rollback'); } catch {} return json({ message: e.message }, 400); }
        finally { c.release(); }
      }
      // Sahte bildirim servisi: gelen şifreli iletiyi saklar
      if (u.pathname.startsWith('/push/')) {
        const parca = [];
        for await (const p of req) parca.push(p);
        pushlar.push({ yol: u.pathname, basliklar: req.headers, govde: Buffer.concat(parca) });
        res.writeHead(u.pathname.endsWith('/olu') ? 410 : 201); return res.end();
      }
      if (u.pathname.startsWith('/api/')) {
        let govde = '';
        for await (const p of req) govde += p;
        const b = govde ? JSON.parse(govde) : {};
        if (u.pathname === '/api/auth') return json(await kimlik(b));
        if (u.pathname === '/api/q') return json(await api(b));
        if (u.pathname === '/api/events') { const s = +u.searchParams.get('since') || 0; return json({ n: sayac, events: olaylar.filter(e => e.n > s) }); }
        if (u.pathname === '/api/presence') {
          if (req.method === 'POST') {
            const m = varlik.get(b.channel) || new Map(); varlik.set(b.channel, m);
            if (b.payload === null) m.delete(b.key); else m.set(b.key, { ref: crypto.randomUUID().slice(0, 8), payload: b.payload });
            return json({ ok: true });
          }
          const m = varlik.get(u.searchParams.get('channel')) || new Map(), st = {};
          for (const [k, v] of m) st[k] = [{ presence_ref: v.ref, ...v.payload }];
          return json(st);
        }
        return json({ error: 'yok' }, 404);
      }
      let yol = decodeURIComponent(u.pathname);
      if (yol === '/') yol = '/index.html';
      if (yol === '/vendor/supabase.js' && !gercek) { res.writeHead(200, { 'content-type': TIP['.js'], 'cache-control': 'no-store' }); return res.end(fs.readFileSync(path.join(__dirname, 'sahte-istemci.js'))); }
      if (yol === '/config.js') { res.writeHead(200, { 'content-type': TIP['.js'], 'cache-control': 'no-store' }); return res.end(`window.TUSDOSTUM_AYAR = { supabaseUrl: location.origin, supabaseAnahtar: "test-acik-anahtar", vapidAcikAnahtar: ${JSON.stringify(vapid)}, google: false };`); }
      const dosya = path.join(kok, yol);
      if (!dosya.startsWith(kok) || !fs.existsSync(dosya) || fs.statSync(dosya).isDirectory()) { res.writeHead(404); return res.end('yok'); }
      res.writeHead(200, { 'content-type': TIP[path.extname(dosya)] || 'application/octet-stream', 'cache-control': 'no-store' });
      res.end(fs.readFileSync(dosya));
    } catch (e) { json({ error: String(e && e.message) }, 500); }
  });
  proto = require('./supabase-protokol.js').ekle(sunucu, { pool, hesaplar, api, AD });
  await new Promise(r => sunucu.listen(port, '127.0.0.1', r));
  const adres = `http://localhost:${sunucu.address().port}`;
  return {
    adres, hesaplar, pushlar,
    kokDegistir: d => { kok = path.resolve(d); },
    // testlerin doğrudan (yönetici olarak) veritabanına bakması için
    sql: async (q, p) => { const r = await pool.query(q, p); return r.rows; },
    olay,
    kapat: async () => { proto.kapat(); sunucu.closeAllConnections && sunucu.closeAllConnections(); await new Promise(r => sunucu.close(r)); await pool.end(); },
  };
}
module.exports = { baslat };
if (require.main === module) baslat(+process.argv[2] || 8787).then(s => console.log('çalışıyor:', s.adres));
