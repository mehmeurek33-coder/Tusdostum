// TEST İÇİN: supabase-js yerine geçen küçük istemci. Yalnızca altyapi.js'in kullandığı parçaları taklit eder
// ve test sunucusuna (sahte-supabase.js) konuşur. Gerçek uygulamada bu dosya KULLANILMAZ.
(function () {
  const post = async (yol, govde) => (await fetch(yol, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(govde) })).json();
  const OTURUM = "sahte.oturum";
  window.__sahte = { cagrilar: [] };
  window.supabase = {
    createClient() {
      const dinleyen = [];
      const oku = () => { try { return JSON.parse(localStorage.getItem(OTURUM) || "null"); } catch { return null; } };
      const uid = () => (oku() || {}).id || "";
      const q = b => { window.__sahte.cagrilar.push(b); return post("/api/q", { uid: uid(), ...b }).catch(e => ({ data: null, error: { message: "Failed to fetch: " + e.message } })); };
      const giris = async (op, email, password) => {
        const r = await post("/api/auth", { op, email, password });
        if (r.error) return { data: { session: null, user: null }, error: r.error };
        localStorage.setItem(OTURUM, JSON.stringify(r.user));
        dinleyen.forEach(f => f("SIGNED_IN", { user: r.user }));
        return { data: { session: { user: r.user }, user: r.user }, error: null };
      };
      const kanallar = new Set();
      let sonOlay = 0, basladi = false;
      const yokla = async () => {
        try {
          const r = await (await fetch("/api/events?since=" + sonOlay)).json();
          sonOlay = r.n;
          for (const e of r.events) for (const k of kanallar) for (const d of k.degisim) {
            if (d.filtre.table !== e.table) continue;
            if (d.filtre.filter && d.filtre.filter.split("=eq.")[1] !== e.uid) continue;
            d.cb({ eventType: "UPDATE", new: {}, old: {} });                 // satır verilmez → altyapı yeniden okur
          }
          for (const k of kanallar) if (k.varlik.length) {
            const st = await (await fetch("/api/presence?channel=" + encodeURIComponent(k.ad))).json();
            const iz = JSON.stringify(st);
            if (iz !== k.iz) { k.iz = iz; k.durum = st; k.varlik.forEach(f => f()); }
          }
        } catch {}
      };
      return {
        auth: {
          async getSession() { const u = oku(); return { data: { session: u ? { user: u } : null }, error: null }; },
          onAuthStateChange(cb) { dinleyen.push(cb); return { data: { subscription: { unsubscribe() {} } } }; },
          signInWithPassword: ({ email, password }) => giris("signIn", email, password),
          signUp: ({ email, password }) => giris("signUp", email, password),
          async signOut() { localStorage.removeItem(OTURUM); dinleyen.forEach(f => f("SIGNED_OUT", null)); return { error: null }; },
          async resetPasswordForEmail() { return { data: {}, error: null }; },
          async updateUser() { return { data: {}, error: null }; },
          async signInWithOAuth() { return { data: {}, error: { message: "testte yok" } }; },
        },
        from(table) {
          return {
            select(cols) {
              const filters = [];
              const b = { eq(c, v) { filters.push([c, v]); return b; }, then(a, r) { return q({ kind: "select", table, cols, filters }).then(a, r); } };
              return b;
            },
            upsert(row) { return q({ kind: "upsert", table, row }); },
            delete() {
              const filters = [];
              const b = { eq(c, v) { filters.push([c, v]); return b; }, then(a, r) { return q({ kind: "delete", table, filters }).then(a, r); } };
              return b;
            },
          };
        },
        rpc(fn, args) { return q({ kind: "rpc", fn, args: args || {} }); },
        channel(ad, secenek) {
          const k = { ad, anahtar: (((secenek || {}).config || {}).presence || {}).key || Math.random().toString(36).slice(2), degisim: [], varlik: [], durum: {}, iz: "" };
          const nesne = {
            on(tur, filtre, cb) { if (tur === "postgres_changes") k.degisim.push({ filtre, cb }); else if (tur === "presence") k.varlik.push(cb); return nesne; },
            subscribe(cb) {
              kanallar.add(k);
              if (!basladi) { basladi = true; const ilk = () => fetch("/api/events").then(r => r.json()).then(r => { sonOlay = r.n; setInterval(yokla, 200); }).catch(() => setTimeout(ilk, 1000)); ilk(); }
              setTimeout(() => cb && cb("SUBSCRIBED"), 0);
              return nesne;
            },
            presenceState() { return k.durum; },
            async track(payload) { await post("/api/presence", { channel: ad, key: k.anahtar, payload }); return "ok"; },
            __k: k,
          };
          return nesne;
        },
        async removeChannel(nesne) { const k = nesne.__k; kanallar.delete(k); await post("/api/presence", { channel: k.ad, key: k.anahtar, payload: null }); },
      };
    },
  };
  // Sayfa kapanırken canlı odadan düş (gerçek Supabase bunu bağlantı kopunca kendisi yapar)
})();
