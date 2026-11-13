#!/usr/bin/env python3
"""GitHub sürümünün index.html dosyasını ana uygulamadan (../index.html) üretir.

Kullanım:  python3 yap.py            → github/index.html yazılır
Ana uygulama değişince bu betik yeniden çalıştırılır; her yama tam bir kez eşleşmezse durur.
"""
import re, sys, pathlib

BURASI = pathlib.Path(__file__).resolve().parent
KAYNAK = pathlib.Path(sys.argv[1]) if len(sys.argv) > 1 else BURASI.parent / "index.html"
HEDEF = BURASI / "index.html"
s = KAYNAK.read_text(encoding="utf-8")


def degis(eski, yeni, ad):
    global s
    n = s.count(eski)
    assert n == 1, f"[{ad}] {n} eşleşme (1 olmalı)"
    s = s.replace(eski, yeni)


def duzenli(desen, yeni, ad, flags=re.S):
    global s
    s, n = re.subn(desen, lambda m: yeni, s, flags=flags)
    assert n == 1, f"[{ad}] {n} eşleşme (1 olmalı)"


# ---------- Sayfa iskeleti ve başlık ----------
degis('<title>TusDostum</title>\n<meta name="claude:viewport-fit-sides" content="cover">\n',
      '<!doctype html>\n<html lang="tr">\n<head>\n<meta charset="utf-8">\n<title>TusDostum</title>\n', "baş")
duzenli(r'<link rel="apple-touch-icon"[^>]*>', '<link rel="apple-touch-icon" sizes="180x180" href="icons/apple-touch-icon.png">', "apple simge")
duzenli(r'<link rel="icon"[^>]*>', '<link rel="icon" type="image/png" sizes="192x192" href="icons/icon-192.png">', "simge")
degis('<meta name="theme-color" content="#0D7A64">',
      '<meta name="theme-color" content="#0D7A64">\n<link rel="manifest" href="manifest.webmanifest">\n'
      '<meta name="mobile-web-app-capable" content="yes">\n<meta name="apple-mobile-web-app-capable" content="yes">\n'
      '<meta name="apple-mobile-web-app-status-bar-style" content="default">\n<meta name="color-scheme" content="light dark">', "manifest")

CSS = r"""
/* ---- GitHub sürümü ekleri ---- */
html, body { margin: 0; }   /* Claude sayfa iskeleti bunu kendisi veriyordu */
.auth { position: fixed; inset: 0; z-index: 60; background: var(--bg); display: grid; place-items: center; overflow-y: auto;
  padding: max(24px, env(safe-area-inset-top, 0px)) 20px max(24px, env(safe-area-inset-bottom, 0px)); }
.auth-card { width: min(400px, 100%); display: grid; gap: 14px; }
.auth-brand { display: flex; align-items: center; justify-content: center; gap: 12px; font-family: var(--f-display); font-weight: 700; font-size: 28px; margin-bottom: 8px; }
.auth-brand svg { width: 46px; height: 46px; display: block; }
.auth input, input[type="email"], input[type="password"] { width: 100%; min-height: 46px; border: 1px solid var(--line); background: var(--surface); border-radius: 10px; padding: 10px 11px; font-weight: 500; color: var(--ink); font-size: 16px; }
.auth .btn { width: 100%; }
.auth .info { color: var(--muted); font-size: 13px; text-align: center; min-height: 1px; }
.timer-card .panel-head { align-items: center; }
.head-r { display: inline-flex; align-items: center; gap: 8px; }
.bell { display: inline-flex; align-items: center; justify-content: center; width: 44px; height: 44px; border-radius: 50%; border: 1px solid var(--line); background: var(--surface); color: var(--muted); padding: 0; }
.bell svg { width: 20px; height: 20px; }
.btn > svg { width: 18px; height: 18px; flex: none; }
.bell.on { color: var(--accent); border-color: var(--accent); background: var(--accent-soft); }
.chips { display: flex; flex-wrap: wrap; gap: 6px; }
.chips button { border: 1px solid var(--line); background: var(--surface); border-radius: 999px; min-height: 44px; min-width: 52px; padding: 0 14px; font-weight: 600; font-size: 15px; color: var(--ink); }
.chips button[aria-checked="true"] { background: var(--accent); border-color: var(--accent); color: var(--accent-ink); }
.acct { display: flex; align-items: center; justify-content: space-between; gap: 10px; flex-wrap: wrap; }
.acct span { overflow-wrap: anywhere; min-width: 0; }
"""
degis("</style>", CSS + "</style>\n</head>\n<body>", "css")
# Tam ekran uygulamada yan ekran görünümü yeniden ortalanır (Claude çubuğu yok)
degis("display: grid; place-items: start center; position: fixed; inset: 0; z-index: 40; background: var(--bg);\n    padding: max(8px, env(safe-area-inset-top, 0px))",
      "display: grid; place-items: center; position: fixed; inset: 0; z-index: 40; background: var(--bg);\n    padding: max(12px, env(safe-area-inset-top, 0px))", "yan ekran")
degis("font-size: min(34vh, 18vw); line-height: 1;", "font-size: min(40vh, 19vw); line-height: 1;", "yan ekran sayaç")

degis("\n<script>\n", '\n<script src="vendor/supabase.js"></script>\n<script src="config.js"></script>\n<script src="altyapi.js"></script>\n<script>\n', "betikler")
assert s.rstrip().endswith("</script>"), "dosya sonu beklenenden farklı"
s = s.rstrip() + "\n</body>\n</html>\n"

# ---------- Sabitler ve durum ----------
degis('const APP_URL = "https://claude.ai/artifact/SYywPSib8yGzSu4NRnLLha";', "const APP_URL = location.origin + location.pathname;", "adres")
degis("  isOwner: false,\n};", "  isOwner: false,\n  lastWorkOver: false,\n  workWarned: 0,\n};", "durum")

# ---------- Çalışma uyarısı + bildirim zamanlaması ----------
UYARI = r"""// Çalışma uyarısı: aralıksız çalışma bu kadar dakikayı geçince bir kez uyarılır (0 = kapalı)
const WORK_WARN_OPTS = [0, 25, 30, 45, 50, 60, 90, 120];
const workWarnMin = () => { const v = Number((S.settings || {}).workWarn); return WORK_WARN_OPTS.includes(v) ? v : 0; };
const runMs = (t, now = Date.now()) => (t && t.runStart ? Math.max(0, now - t.runStart) : 0);
const workOver = (t, now = Date.now()) => { const w = workWarnMin(); return !!w && runMs(t, now) >= w * 60000 && runMs(t, now) < MAX_RUN_MS; };
function workAlert() {
  const t = S.timer; if (!t || !t.runStart || S.workWarned === t.runStart) return;
  S.workWarned = t.runStart;
  beep();
  try { if (navigator.vibrate) navigator.vibrate([250, 120, 250]); } catch {}
  toast(`Aralıksız çalışman ${workWarnMin()} dakikayı geçti.`);
}
// Ekran kapalıyken bildirim: sunucuya "şu saatte haber ver" listesi bırakılır
const pushOn = () => { const A = window.TusAltyapi; return !!(A && S.mode === "cloud" && A.bildirim.acik()); };
const pushState = () => { const A = window.TusAltyapi; return A && S.mode === "cloud" ? A.bildirim.durum() : "yok"; };
// Bir dokunuşun içinden çağrılır: izin ister, cihazı kaydeder; açılırsa sessiz ses kaydı durur
function enablePush(after) {
  const A = window.TusAltyapi; if (!A || S.mode !== "cloud") return;
  A.bildirim.ac().then(ok => {
    if (ok) { stopBreakAudio(); toast("Bildirimler açık."); }
    else toast(A.bildirim.izin() === "denied" ? "Bildirim izni verilmedi." : "Bildirimler açılamadı.");
    syncAlerts(); renderTimerCard(); if (after) after();
  });
}
function syncAlerts() {
  const A = window.TusAltyapi; if (!A || S.mode !== "cloud" || readOnly()) return;
  const t = S.timer, now = Date.now(), out = [];
  if (t && onBreak(t)) { const w = breakWarnMin(); if (w) out.push({ tur: "mola", zaman: t.breakStart + w * 60000, dk: w }); }
  else if (t && t.runStart) {
    const w = workWarnMin(); if (w) out.push({ tur: "calisma", zaman: t.runStart + w * 60000, dk: w });
    out.push({ tur: "sinir", zaman: t.runStart + MAX_RUN_MS, dk: 180 });
  }
  A.bildirim.ayarla(out.filter(x => x.zaman > now + 5000));
}
const BELL_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9a6 6 0 0 1 12 0c0 6 2.5 7.5 2.5 7.5h-17S6 15 6 9zM10 20a2 2 0 0 0 4 0"/></svg>`;
function openAlerts() {
  const A = window.TusAltyapi, ro = readOnly();
  const chips = (name, opts, cur) => `<div class="chips" role="radiogroup" data-chips="${name}">${opts.map(v =>
    `<button type="button" role="radio" aria-checked="${v === cur}" data-v="${v}"${ro ? " disabled" : ""}>${v || "Kapalı"}</button>`).join("")}</div>`;
  const note = () => {
    if (!A || S.mode !== "cloud" || (!breakWarnMin() && !workWarnMin())) return "";
    const d = pushState();
    if (d === "acik") return `<span class="hint">Bildirimler açık.</span>`;
    if (d === "sor") return `<button class="btn primary" type="button" id="alPush">Bildirimleri aç</button>`;
    if (d === "anaEkran") return `<span class="hint">Ekran kapalıyken bildirim için uygulamayı ana ekrana ekle ve oradan aç.</span>`;
    if (d === "reddedildi") return `<span class="hint">Bildirim izni kapalı; telefon ayarlarından aç.</span>`;
    return `<span class="hint">Bu cihazda bildirim yok; uyarı uygulama açıkken çalar.</span>`;
  };
  const body = `
    <div class="field">Mola uzayınca uyar (dk)${chips("breakWarn", BREAK_WARN_OPTS, breakWarnMin())}</div>
    <div class="field">Aralıksız çalışınca uyar (dk)${chips("workWarn", WORK_WARN_OPTS, workWarnMin())}</div>
    <div id="alNote">${note()}</div>`;
  openModal(formShell("alForm", "alTitle", "Uyarılar", body, `<button class="btn primary" type="button" data-close-modal>Tamam</button>`));
  const f = $("alForm");
  const redraw = () => { const n = $("alNote"); if (n) n.innerHTML = note(); };
  f.addEventListener("submit", e => e.preventDefault());
  f.addEventListener("click", e => {
    if (e.target.closest("[data-close-modal]")) { closeModal(); return; }
    if (e.target.closest("#alPush")) { enablePush(redraw); return; }
    const b = e.target.closest("[data-chips] button"); if (!b || readOnly()) return;
    const key = b.parentElement.dataset.chips, v = +b.dataset.v;
    writeSettings({ [key]: v });
    b.parentElement.querySelectorAll("button").forEach(x => x.setAttribute("aria-checked", String(x === b)));
    if (v) {
      armSound();
      if (pushState() === "sor") { enablePush(redraw); return; }
    }
    redraw(); syncAlerts(); renderTimerCard();
  });
}
function firstDayKey() {"""
degis("function firstDayKey() {", UYARI, "uyarı işlevleri")

degis('if (code === "invalid_argument") { S.canWrite = false; toast("Bu sayfada kayıt ekleme iznin yok."); }',
      'if (code === "invalid_argument" || code === "not_permitted") { S.canWrite = false; toast("Hesabın kayıt ekleyemiyor."); }', "yazma hatası")

degis("  pushPresence(); renderTimerCard(); renderHeader(); renderStrip(); renderToday();\n}\nfunction startTimer() {",
      "  syncAlerts();\n  pushPresence(); renderTimerCard(); renderHeader(); renderStrip(); renderToday();\n}\nfunction startTimer() {", "setTimer")
degis("workMs: 0, breakStart: null, breakMs: 0, bn: 0 });\n  requestWake();",
      "workMs: 0, breakStart: null, breakMs: 0, bn: 0 });\n  if (workWarnMin()) armSound();\n  requestWake();", "başlat")
degis("if (breakWarnMin()) { armSound(); startBreakAudio(); requestWake(); }",
      "if (breakWarnMin()) { armSound(); if (!pushOn()) startBreakAudio(); requestWake(); }", "mola sesi")
degis("breakStart: null, runStart: now, bn: num(t.bn) + 1 });\n  requestWake();",
      "breakStart: null, runStart: now, bn: num(t.bn) + 1 });\n  if (workWarnMin()) armSound();\n  requestWake();", "dön")

# ---------- Açılış: oturum → bulut ----------
duzenli(r'  const c = window\.claude;\n  if \(!c \|\| typeof c\.use !== "function"\) \{ startLocal\(\); return; \}\n.*?  if \(room\) \{ S\.roomState = "on"; syncRooms\(\); \} else S\.roomState = "off";\n',
        r"""  const A = window.TusAltyapi;
  if (!A || !A.hazir) { startLocal(); return; }
  A.odaKodu = roomCode;
  A.kurtarmaOlunca(openNewPass);
  let ses = null;
  try { ses = await A.oturum(); } catch {}
  try { const h = sessionStorage.getItem("td.davet"); if (h) { sessionStorage.removeItem("td.davet"); if (!location.hash.startsWith("#oda-")) location.hash = h; } } catch {}
  if (!ses) { openAuth(); return; }
  await bootCloud();
}
async function bootCloud() {
  const c = window.claude, A = window.TusAltyapi;
  try { [db, user, room, downloads] = await Promise.all([c.use("db"), c.use("user"), c.use("room"), c.use("downloads")]); }
  catch { db = user = room = downloads = null; }
  if (user) {
    try { const me = await user.me(); S.me = { id: me.id }; } catch {}
    try { const cw = await user.can("data.write"); if (cw === false) S.canWrite = false; } catch {}
    try { S.isOwner = !!(await user.isOwner()); } catch {}
  }
  if (db && S.me.id) startCloud(); else startLocal();
  if (room) { S.roomState = "on"; syncRooms(); } else S.roomState = "off";
  A.bildirim.degisince(() => { if (pushOn()) stopBreakAudio(); renderTimerCard(); });
  A.bildirim.hazirla();
  if (A.kurtarmaMi()) openNewPass();
""", "açılış")
degis('function startLocal() {\n  S.mode = "local";', 'function startLocal() {\n  S.mode = "local";\n  if (!downloads) downloads = (window.TusAltyapi && window.TusAltyapi.indirme) || null;', "yerel")
degis("ensureFirstDay(); syncShared(); checkLocalImport(); render(); renderTimerCard(); maybeOnboard(); });",
      "ensureFirstDay(); syncShared(); checkLocalImport(); syncAlerts(); render(); renderTimerCard(); maybeOnboard(); });", "hazır")

duzenli(r'  if \(S\.mode === "local"\) msgs\.push\(esc\("Yerel moddasın:[^\n]*\n',
        '  if (S.mode === "local") msgs.push(esc("Sunucu ayarı yapılmamış: kayıtların sadece bu tarayıcıda tutuluyor."));\n', "yerel afiş", flags=0)
duzenli(r'  if \(S\.mode === "cloud" && !S\.canWrite\) msgs\.push\(esc\("Bu sayfayı sadece[^\n]*\n',
        '  if (S.mode === "cloud" && !S.canWrite) msgs.push(esc("Hesabın bu uygulamada kapatılmış; kayıt ekleyemezsin."));\n', "izin afişi", flags=0)

# ---------- Kronometre kartı: zil ve çalışma uyarısı ----------
degis("  const longBreak = breakOver(t);\n  S.lastBreakOver = longBreak;",
      "  const longBreak = breakOver(t);\n  S.lastBreakOver = longBreak;\n  const longRun = !over && workOver(t);\n  S.lastWorkOver = longRun;\n  const alertsOn = !!(breakWarnMin() || workWarnMin());\n  const ps = alertsOn ? pushState() : \"yok\";", "kart durumu")
degis('<div class="panel-head"><h2>Kronometre</h2>${pill}</div>',
      '<div class="panel-head"><h2>Kronometre</h2><span class="head-r"><button class="bell${alertsOn ? " on" : ""}" data-act="alerts" type="button" aria-label="Uyarılar" aria-pressed="${alertsOn}">${BELL_SVG}</button>${pill}</span></div>', "zil")
degis('    ${longBreak ? `<div class="nudge">Molan ${breakWarnMin()} dakikayı geçti.</div>` : ""}',
      '    ${longBreak ? `<div class="nudge">Molan ${breakWarnMin()} dakikayı geçti.</div>` : ""}\n    ${longRun ? `<div class="nudge">Aralıksız çalışman ${workWarnMin()} dakikayı geçti.</div>` : ""}\n    ${ps === "sor" ? `<div class="tc-actions" style="margin-top:10px"><button class="btn sm" data-act="push-on" type="button">${BELL_SVG}Bildirimleri aç</button></div>` : ps === "anaEkran" ? `<div class="nudge">Ekran kapalıyken bildirim için ana ekrana ekle.</div>` : ""}', "çalışma uyarı satırı")
degis("if ((runOverflow(t, now) > 0) !== S.lastOverflow || breakOver(t, now) !== S.lastBreakOver) renderTimerCard();",
      "if ((runOverflow(t, now) > 0) !== S.lastOverflow || breakOver(t, now) !== S.lastBreakOver || (runOverflow(t, now) <= 0 && workOver(t, now)) !== S.lastWorkOver) renderTimerCard();", "tik")
degis('  else if (a === "manual") { if (!readOnly()) openManualForm({ s: S.pick.s, t: S.pick.t, d: todayKey() }); }',
      '  else if (a === "manual") { if (!readOnly()) openManualForm({ s: S.pick.s, t: S.pick.t, d: todayKey() }); }\n  else if (a === "alerts") openAlerts();\n  else if (a === "push-on") enablePush();', "zil tıklama")
degis("  if (breakOver(S.timer)) breakAlert();", "  if (breakOver(S.timer)) breakAlert();\n  if (workOver(S.timer)) workAlert();", "aralık")

degis("Erişimi sürüyorsa uygulamayı açınca yeniden görünür.", "Listelerden çıkar ve yeniden katılamaz.", "çıkarma metni")

# ---------- Davet: yalnızca bağlantı ----------
duzenli(r"  const text = `TusDostum'da \$\{personal \? `\"\$\{lab\}\" odasında ` : \"\"\}birlikte çalışalım\.[^\n]*\n",
        "  const text = `TusDostum'da ${personal ? `\"${lab}\" odasında ` : \"\"}birlikte çalışalım: ${link}`;\n", "davet metni", flags=0)
duzenli(r'    <div class="howto"><ol>\n      <li>Arkadaşından claude\.ai.*?</ol></div>\n', "", "davet adımları")
degis('<textarea id="invText" readonly rows="5"', '<textarea id="invText" readonly rows="3"', "davet kutusu")

# ---------- Ayarlar ----------
duzenli(r'    <label class="field">Mola uyarısı<select id="gBW">.*?</span></label>\n', "", "ayarlardan mola uyarısı")
degis('<button class="btn sm" type="button" data-backup="csv">Kayıtları indir (CSV)</button></span></div>` : ""}',
      '<button class="btn sm" type="button" data-backup="csv">Kayıtları indir (CSV)</button>'
      '<button class="btn sm" type="button" id="gRestore"${ro ? " disabled" : ""}>Yedekten yükle</button><input type="file" id="gFile" accept="application/json,.json" hidden></span></div>` : ""}', "yedekten yükle")
duzenli(r'    <div class="howto"><span class="sec-title">Telefonun ana ekranına ekle</span>.*?</ol></div>\n',
        r"""    ${standalone() ? "" : `<div class="howto"><span class="sec-title">Ana ekrana ekle</span>
      <ol>
        <li><b>iPhone:</b> Safari → paylaş düğmesi → "Ana Ekrana Ekle".</li>
        <li><b>Android:</b> Chrome → üç nokta → "Ana ekrana ekle".</li>
      </ol></div>`}
    ${S.mode === "cloud" && window.TusAltyapi ? `<div class="howto"><span class="sec-title">Hesap</span>
      <div class="acct"><span>${esc(window.TusAltyapi.eposta())}</span><button class="btn sm" type="button" id="gOut">Çıkış yap</button></div></div>` : ""}
""", "ana ekran + hesap")
degis("    const bk = e.target.closest(\"[data-backup]\"); if (bk) { saveBackup(bk.dataset.backup); return; }",
      "    const bk = e.target.closest(\"[data-backup]\"); if (bk) { saveBackup(bk.dataset.backup); return; }\n"
      "    if (e.target.closest(\"#gRestore\")) { $(\"gFile\").click(); return; }\n"
      "    if (e.target.closest(\"#gOut\")) { window.TusAltyapi.cikis(); return; }", "ayar tıklamaları")
degis("  drawRooms();\n  f.addEventListener(\"click\", e => {",
      "  drawRooms();\n  if ($(\"gFile\")) $(\"gFile\").addEventListener(\"change\", e => { const fl = e.target.files && e.target.files[0]; e.target.value = \"\"; if (fl) restoreFromFile(fl); });\n  f.addEventListener(\"click\", e => {", "dosya seçimi")
# Oda var mı: oda adları sunucuda gizli olduğu için denetimi sunucu yapar
degis("async function roomExists(key) {\n  const me = myId();",
      "async function roomExists(key) {\n  const A = window.TusAltyapi;\n  if (A && S.mode === \"cloud\" && A.odaVarMi) return A.odaVarMi(key);\n  const me = myId();", "oda var mı")
degis('writeSettings({ goalMin: gm, goalQ: gq, examDate: ge || "", breakWarn: BREAK_WARN_OPTS.includes(+$("gBW").value) ? +$("gBW").value : 0 });\n    if (breakWarnMin()) armSound();\n',
      'writeSettings({ goalMin: gm, goalQ: gq, examDate: ge || "" });\n', "ayar kaydı")

# ---------- Yedekten yükleme, giriş ekranı, yeni şifre ----------
SON = r"""const standalone = () => { try { return matchMedia("(display-mode: standalone)").matches || navigator.standalone === true; } catch { return false; } };

// ---------- Yedekten yükleme ----------
// Var olan kayıtlara dokunmaz; yalnızca yedekte olup hesapta olmayanları ekler.
function importBackup(obj) {
  if (!obj || typeof obj !== "object" || obj.uygulama !== "TusDostum") throw new Error("yedek değil");
  const add = { kron: {}, elle: {} }; let n = 0;
  const take = (list, kind, norm, cur) => {
    for (const raw of Array.isArray(list) ? list : []) {
      if (!raw || typeof raw !== "object" || raw.id == null) continue;
      const { id, kind: _k, unranked: _u, ...body } = raw;
      const e = norm(id, body); if (!e) continue;
      const ym = e.d.slice(0, 7), key = String(id);
      if ((cur[ym] || {})[key] || (add[kind][ym] || {})[key]) continue;
      (add[kind][ym] || (add[kind][ym] = {}))[key] = body; n++;
    }
  };
  take(obj.kronometreli, "kron", normOwnTimed, S.kron);
  take(obj.elle, "elle", normManual, S.manual);
  const den = {};
  for (const raw of Array.isArray(obj.denemeler) ? obj.denemeler : []) {
    if (!raw || typeof raw !== "object" || raw.id == null || !isDateStr(raw.d) || S.denemeler[raw.id]) continue;
    den[String(raw.id)] = { n: typeof raw.n === "string" ? raw.n.slice(0, 60) : "Deneme", d: raw.d, td: clampNum(raw.td, 0, 300), ty: clampNum(raw.ty, 0, 300), kd: clampNum(raw.kd, 0, 300), ky: clampNum(raw.ky, 0, 300), ts: clampNum(raw.ts, 0, 9e15) || Date.now() };
    n++;
  }
  for (const kind of ["kron", "elle"]) for (const ym of Object.keys(add[kind])) {
    const ents = add[kind][ym];
    if (kind === "kron") S.kron = { ...S.kron, [ym]: { ...(S.kron[ym] || {}), ...ents } };
    else S.manual = { ...S.manual, [ym]: { ...(S.manual[ym] || {}), ...ents } };
    if (S.mode === "cloud") privUpsert(`${kind}-${ym}`, { entries: ents }, { ym, entries: ents });
  }
  if (Object.keys(den).length) {
    S.denemeler = { ...S.denemeler, ...den };
    if (S.mode === "cloud") privUpsert("denemeler", { items: den }, { items: den });
  }
  // Ayarlar: yalnızca boş olanlar doldurulur
  const a = obj.ayarlar && typeof obj.ayarlar === "object" ? obj.ayarlar : {}, patch = {};
  for (const k of ["goalMin", "goalQ", "examDate", "breakWarn", "workWarn"]) if (a[k] != null && a[k] !== "" && (S.settings[k] == null || S.settings[k] === "")) patch[k] = a[k];
  if (Object.keys(patch).length) writeSettings(patch);
  if (S.mode !== "cloud") persistLocal();
  return n;
}
function restoreFromFile(file) {
  if (readOnly()) return;
  const r = new FileReader();
  r.onload = () => {
    let n;
    try { n = importBackup(JSON.parse(String(r.result))); }
    catch { toast("Bu dosya bir TusDostum yedeği değil."); return; }
    ensureFirstDay(); syncShared(); render();
    toast(n ? `${n} kayıt eklendi.` : "Yedekteki kayıtların hepsi zaten var.");
  };
  r.onerror = () => toast("Dosya okunamadı.");
  r.readAsText(file);
}

// ---------- Giriş ekranı ----------
function openAuth() {
  const A = window.TusAltyapi;
  let el = $("authView");
  if (!el) { el = document.createElement("div"); el.id = "authView"; el.className = "auth"; document.body.appendChild(el); }
  let mode = "giris", busy = false;
  const mark = (document.querySelector(".brand-mark") || {}).innerHTML || "";
  const draw = (info = "", err = "", mail = "") => {
    el.innerHTML = `<form class="auth-card" id="authForm" novalidate>
      <div class="auth-brand">${mark}<span>TusDostum</span></div>
      <div class="seg two" role="radiogroup" aria-label="Hesap">
        <button type="button" role="radio" data-mode="giris" aria-checked="${mode === "giris"}">Giriş yap</button>
        <button type="button" role="radio" data-mode="kayit" aria-checked="${mode === "kayit"}">Kayıt ol</button></div>
      <label class="field">E-posta<input type="email" id="aMail" autocomplete="email" inputmode="email" autocapitalize="none" spellcheck="false" value="${esc(mail)}"></label>
      <label class="field">Şifre<input type="password" id="aPass" autocomplete="${mode === "giris" ? "current-password" : "new-password"}"></label>
      <div class="err" id="aErr" role="alert">${esc(err)}</div>
      <button class="btn primary" type="submit" id="aGo">${mode === "giris" ? "Giriş yap" : "Kayıt ol"}</button>
      ${A.google ? `<button class="btn" type="button" id="aGoogle">Google ile devam et</button>` : ""}
      ${mode === "giris" && A.epostaVar ? `<button class="btn ghost" type="button" id="aForgot">Şifremi unuttum</button>` : ""}
      <div class="info" id="aInfo">${esc(info)}</div>
    </form>`;
  };
  const mailVal = () => ($("aMail").value || "").trim();
  const fail = m => { $("aErr").textContent = m; $("aInfo").textContent = ""; };
  draw();
  el.onclick = async e => {
    const mb = e.target.closest("[data-mode]");
    if (mb) { mode = mb.dataset.mode; draw("", "", mailVal()); return; }
    if (busy) return;
    if (e.target.closest("#aGoogle")) {
      try { if (location.hash.startsWith("#oda-")) sessionStorage.setItem("td.davet", location.hash); } catch {}
      try { await A.googleIle(); } catch (x) { fail(x.message); }
      return;
    }
    if (e.target.closest("#aForgot")) {
      const m = mailVal();
      if (!m) { fail("Önce e-postanı yaz."); return; }
      busy = true;
      try { await A.sifreSifirla(m); $("aErr").textContent = ""; $("aInfo").textContent = "Sıfırlama bağlantısı e-postana gönderildi."; }
      catch (x) { fail(x.message); }
      busy = false;
    }
  };
  el.onsubmit = async e => {
    e.preventDefault();
    if (busy) return;
    const m = mailVal(), p = $("aPass").value || "";
    if (!m || !/.+@.+\..+/.test(m)) { fail("Geçerli bir e-posta yaz."); return; }
    if (p.length < 6) { fail("Şifre en az 6 karakter olmalı."); return; }
    busy = true; $("aGo").disabled = true; $("aErr").textContent = "";
    try {
      await (mode === "giris" ? A.girisYap(m, p) : A.kayitOl(m, p));
      el.remove();
      await bootCloud();
      render(); renderTimerCard();
    } catch (x) {
      busy = false;
      if (x && x.code === "onay") { mode = "giris"; draw(x.message, "", m); }
      else { if ($("aGo")) $("aGo").disabled = false; fail((x && x.message) || "İşlem yapılamadı."); }
    }
  };
}
// Şifre sıfırlama bağlantısından gelindiğinde yeni şifre sorulur
function openNewPass() {
  if ($("npForm")) return;
  openModal(formShell("npForm", "npTitle", "Yeni şifre",
    `<label class="field">Yeni şifre<input type="password" id="npPass" autocomplete="new-password"></label><div class="err" id="npErr" role="alert"></div>`,
    `<button class="btn primary" type="submit">Kaydet</button>`));
  $("npForm").addEventListener("submit", async e => {
    e.preventDefault();
    const p = $("npPass").value || "";
    if (p.length < 6) { $("npErr").textContent = "Şifre en az 6 karakter olmalı."; return; }
    try { await window.TusAltyapi.yeniSifre(p); closeModal(); toast("Şifren değişti."); }
    catch (x) { $("npErr").textContent = (x && x.message) || "İşlem yapılamadı."; }
  });
}

boot();
})();"""
degis("\nboot();\n})();", "\n" + SON, "son ekler")

assert "claude.ai" not in s, "claude.ai kalıntısı var"
HEDEF.write_text(s, encoding="utf-8")
print(f"yazıldı: {HEDEF} ({len(s)} bayt)")
