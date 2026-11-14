// TEST İÇİN: Supabase'in gerçek ağ protokollerinin küçük bir alt kümesi (Auth, PostgREST, Realtime).
// Böylece uygulama GERÇEK supabase-js kütüphanesiyle (vendor/supabase.js) çalıştırılıp denenebilir.
// Sorgular yine gerçek PostgreSQL'de, satır düzeyi güvenlik açıkken çalışır.
const crypto = require('crypto');
const { WebSocketServer } = require('ws');

const b64u = o => Buffer.from(JSON.stringify(o)).toString('base64url');
const jwtYap = (id, email) => `${b64u({ alg: 'HS256', typ: 'JWT' })}.${b64u({ sub: id, email, role: 'authenticated', aud: 'authenticated', iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 3600 })}.imza`;
const jwtUid = t => { try { return JSON.parse(Buffer.from(String(t).split('.')[1], 'base64url').toString()).sub || ''; } catch { return ''; } };
const SUTUN = {
  profiller: [['uid', 'uuid'], ['veri', 'jsonb'], ['guncellendi', 'timestamptz']],
  son_gunler: [['uid', 'uuid'], ['son', 'jsonb'], ['guncellendi', 'timestamptz']],
  ozel_belgeler: [['uid', 'uuid'], ['belge', 'text'], ['veri', 'jsonb'], ['guncellendi', 'timestamptz']],
  oda_uyeleri: [['uid', 'uuid'], ['oda', 'text']],
  tebrik_ozet: [['uid', 'uuid'], ['toplam', 'int4'], ['gun', 'date'], ['bugun', 'int4']],
  etkilesimler: [['id', 'int8'], ['alici', 'uuid']],
};

function ekle(sunucu, { pool, hesaplar, api, AD }) {
  const oturum = (id, email) => ({ access_token: jwtYap(id, email), token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, refresh_token: 'yenile-' + id,
    user: { id, aud: 'authenticated', role: 'authenticated', email, email_confirmed_at: new Date().toISOString(), app_metadata: { provider: 'email' }, user_metadata: {}, created_at: new Date().toISOString() } });

  // ---------- Auth ----------
  async function auth(req, u, b, json) {
    const yol = u.pathname.slice('/auth/v1'.length);
    const eposta = String(b.email || '').toLowerCase();
    if (yol === '/signup') {
      if (hesaplar.has(eposta)) return json({ code: 422, error_code: 'user_already_exists', msg: 'User already registered' }, 422);
      if (String(b.password || '').length < 6) return json({ code: 422, error_code: 'weak_password', msg: 'Password should be at least 6 characters.' }, 422);
      const id = crypto.randomUUID();
      hesaplar.set(eposta, { id, sifre: b.password });
      await pool.query('insert into auth.users (id, email) values ($1, $2)', [id, eposta]);
      return json(oturum(id, eposta));
    }
    if (yol === '/token') {
      if (u.searchParams.get('grant_type') === 'refresh_token') {
        const id = String(b.refresh_token || '').replace('yenile-', '');
        const h = [...hesaplar.entries()].find(x => x[1].id === id);
        return h ? json(oturum(id, h[0])) : json({ code: 400, error_code: 'refresh_token_not_found', msg: 'Invalid Refresh Token' }, 400);
      }
      const h = hesaplar.get(eposta);
      if (!h || h.sifre !== b.password) return json({ code: 400, error_code: 'invalid_credentials', msg: 'Invalid login credentials' }, 400);
      return json(oturum(h.id, eposta));
    }
    if (yol === '/logout') return json(null, 204);
    if (yol === '/user') { const id = jwtUid((req.headers.authorization || '').replace('Bearer ', '')); const h = [...hesaplar.entries()].find(x => x[1].id === id); return h ? json(oturum(id, h[0]).user) : json({ msg: 'yok' }, 401); }
    if (yol === '/recover') return json({});
    return json({ msg: 'desteklenmiyor: ' + yol }, 404);
  }

  // ---------- PostgREST (kullanıcı olarak) ----------
  const hataYanit = (e, json) => json({ code: e.code || 'P0001', message: e.message, details: null, hint: null }, e.code === '42501' ? 403 : 400);
  async function rest(req, u, b, json) {
    const uid = jwtUid((req.headers.authorization || '').replace('Bearer ', ''));
    const parca = u.pathname.split('/').filter(Boolean);            // rest, v1, tablo | rpc, işlev
    if (parca[2] === 'rpc') {
      const r = await api({ uid, kind: 'rpc', fn: parca[3], args: b || {} });
      return r.error ? hataYanit(r.error, json) : json(r.data === undefined ? null : r.data);
    }
    const table = parca[2];
    const filters = [...u.searchParams.entries()].filter(([k, v]) => !['select', 'on_conflict', 'columns'].includes(k) && v.startsWith('eq.')).map(([k, v]) => [k, v.slice(3)]);
    if (req.method === 'GET') {
      const r = await api({ uid, kind: 'select', table, cols: u.searchParams.get('select') || '*', filters });
      return r.error ? hataYanit(r.error, json) : json(r.data);
    }
    if (req.method === 'POST') {
      const row = Array.isArray(b) ? b[0] : b;
      if (!/resolution=merge-duplicates/.test(req.headers.prefer || '')) return json({ message: 'testte yalnızca upsert var' }, 400);
      const r = await api({ uid, kind: 'upsert', table, row });
      return r.error ? hataYanit(r.error, json) : json(null, 201);
    }
    if (req.method === 'DELETE') {
      const r = await api({ uid, kind: 'delete', table, filters });
      return r.error ? hataYanit(r.error, json) : json(null, 204);
    }
    return json({ message: 'yöntem yok' }, 405);
  }

  // ---------- Realtime (Phoenix kanalları, 2.0.0 dizi biçimi) ----------
  const wss = new WebSocketServer({ noServer: true });
  const soketler = new Set();
  const varlik = new Map();                                          // konu -> Map(soket -> { key, meta })
  sunucu.on('upgrade', (req, sock, head) => {
    if (!req.url.startsWith('/realtime/v1/websocket')) { sock.destroy(); return; }
    wss.handleUpgrade(req, sock, head, ws => {
      const s = { ws, kanallar: new Map() }; soketler.add(s);
      const yolla = (jr, ref, konu, olay, yuk) => { if (ws.readyState === 1) ws.send(JSON.stringify([jr, ref, konu, olay, yuk])); };
      s.yolla = yolla;
      const herkese = (konu, olay, yuk) => { for (const o of soketler) { const k = o.kanallar.get(konu); if (k) o.yolla(k.joinRef, null, konu, olay, yuk); } };
      const ayril = konu => {
        const m = varlik.get(konu), eski = m && m.get(s);
        if (eski) { m.delete(s); herkese(konu, 'presence_diff', { joins: {}, leaves: { [eski.key]: { metas: [eski.meta] } } }); }
      };
      ws.on('message', veri => {
        let msg; try { msg = JSON.parse(veri.toString()); } catch { return; }
        const [jr, ref, konu, olay, yuk] = msg;
        if (konu === 'phoenix') { yolla(null, ref, konu, 'phx_reply', { status: 'ok', response: {} }); return; }
        if (olay === 'phx_join') {
          const cfg = (yuk && yuk.config) || {};
          const baglar = (cfg.postgres_changes || []).map((x, i) => ({ id: 1000 + s.kanallar.size * 100 + i, event: x.event, schema: x.schema, table: x.table, filter: x.filter }));
          s.kanallar.set(konu, { joinRef: jr, baglar, uid: jwtUid(yuk && yuk.access_token), key: (cfg.presence && cfg.presence.key) || crypto.randomUUID() });
          yolla(jr, ref, konu, 'phx_reply', { status: 'ok', response: { postgres_changes: baglar } });
          const m = varlik.get(konu) || new Map(), durum = {};
          for (const v of m.values()) (durum[v.key] || (durum[v.key] = { metas: [] })).metas.push(v.meta);
          yolla(jr, null, konu, 'presence_state', durum);
          return;
        }
        const k = s.kanallar.get(konu); if (!k) return;
        if (olay === 'access_token') { k.uid = jwtUid(yuk && yuk.access_token) || k.uid; return; }
        if (olay === 'phx_leave') { ayril(konu); s.kanallar.delete(konu); yolla(jr, ref, konu, 'phx_reply', { status: 'ok', response: {} }); return; }
        if (olay === 'presence' && yuk && yuk.event === 'track') {
          const m = varlik.get(konu) || new Map(); varlik.set(konu, m);
          const eski = m.get(s), meta = { phx_ref: crypto.randomUUID().slice(0, 10), ...(yuk.payload || {}) };
          m.set(s, { key: k.key, meta });
          herkese(konu, 'presence_diff', { joins: { [k.key]: { metas: [meta] } }, leaves: eski ? { [eski.key]: { metas: [eski.meta] } } : {} });
          yolla(jr, ref, konu, 'phx_reply', { status: 'ok', response: {} });
          return;
        }
        if (olay === 'presence' && yuk && yuk.event === 'untrack') { ayril(konu); yolla(jr, ref, konu, 'phx_reply', { status: 'ok', response: {} }); return; }
        yolla(jr, ref, konu, 'phx_reply', { status: 'ok', response: {} });
      });
      ws.on('close', () => { for (const konu of [...s.kanallar.keys()]) ayril(konu); soketler.delete(s); });
    });
  });

  // Veritabanı değişikliği: her aboneye, o kişinin GÖREBİLDİĞİ satır gönderilir (gerçek Realtime da RLS uygular)
  async function degisim(table, satirUid, belge) {
    if (!SUTUN[table]) return;
    for (const s of soketler) for (const [konu, k] of s.kanallar) {
      const ids = k.baglar.filter(x => x.table === table && (!x.filter || x.filter.split('=eq.')[1] === satirUid)).map(x => x.id);
      if (!ids.length || !k.uid) continue;
      if (table === 'etkilesimler') {                                 // yalnızca "yeni bir şey var" haberi
        s.yolla(k.joinRef, null, konu, 'postgres_changes', { ids, data: { schema: 'public', table, commit_timestamp: new Date().toISOString(), columns: SUTUN[table].map(([name, type]) => ({ name, type })), errors: null, type: 'INSERT', record: { id: 0, alici: satirUid }, old_record: null } });
        continue;
      }
      const filtre = [['uid', satirUid]]; if (table === 'ozel_belgeler' && belge) filtre.push(['belge', belge]);
      const r = await api({ uid: k.uid, kind: 'select', table, cols: SUTUN[table].map(x => x[0]).join(','), filters: filtre, sessiz: true });
      const satir = r.data && r.data[0];
      const data = { schema: 'public', table, commit_timestamp: new Date().toISOString(), columns: SUTUN[table].map(([name, type]) => ({ name, type })), errors: null };
      if (satir) Object.assign(data, { type: 'UPDATE', record: satir, old_record: { uid: satirUid } });
      else Object.assign(data, { type: 'DELETE', record: null, old_record: table === 'ozel_belgeler' ? { uid: satirUid, belge } : { uid: satirUid } });
      s.yolla(k.joinRef, null, konu, 'postgres_changes', { ids, data });
    }
  }
  return { auth, rest, degisim, kapat: () => { for (const s of soketler) try { s.ws.terminate(); } catch {} wss.close(); } };
}
module.exports = { ekle };
