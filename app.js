/* PokéScan — scanne une carte Pokémon FR et affiche son prix.
 *
 * Principe : on lit le numéro imprimé en bas de la carte (ex. « 4/102 »).
 * Le total (/102) désigne l'extension, le premier nombre la carte dans l'extension.
 * Si plusieurs extensions ont le même total, on lit aussi le nom en haut de la carte
 * pour départager ; sinon l'utilisateur choisit sur les images.
 * Données : API TCGdex (gratuite, sans clé), prix Cardmarket + TCGplayer inclus.
 */
"use strict";

const API = "https://api.tcgdex.net/v2/fr";
const $ = (id) => document.getElementById(id);
const video = $("video"), frame = $("frame"), hintEl = $("hint");

const state = {
  stream: null, track: null, torch: false,
  auto: load("auto", true),
  busy: false, reads: [], lastHit: Date.now(), pausedUntil: 0, cycle: 0,
  numWorker: null, nameWorker: null,
  sets: null, counts: null,
  current: null,
  lot: load("lot", []),
};

/* ---------- Petits utilitaires ---------- */
function load(k, d) { try { const v = JSON.parse(localStorage.getItem("pokescan:" + k)); return v ?? d; } catch { return d; } }
function save(k, v) { try { localStorage.setItem("pokescan:" + k, JSON.stringify(v)); } catch {} }
const eur = (v) => v == null || isNaN(v) ? "—" : Number(v).toLocaleString("fr-FR", { style: "currency", currency: "EUR" });
const usd = (v) => v == null || isNaN(v) ? "—" : Number(v).toLocaleString("fr-FR", { style: "currency", currency: "USD" });
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const img = (base, q = "low") => base ? `${base}/${q}.webp` : "";
const buzz = (p) => { try { navigator.vibrate?.(p); } catch {} };

function hint(html) { hintEl.innerHTML = html; }
let toastTimer;
function toast(msg) {
  const t = $("toast"); t.textContent = msg; t.classList.add("on");
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove("on"), 2200);
}

async function api(path) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 9000);
  try {
    const r = await fetch(API + path, { signal: ctrl.signal });
    if (r.status === 404) return null;
    if (!r.ok) throw new Error("Le serveur TCGdex a répondu " + r.status);
    return await r.json();
  } catch (e) {
    if (e.name === "AbortError") throw new Error("Réseau trop lent, réessaie");
    throw e;
  } finally { clearTimeout(timer); }
}

/* ---------- Extensions (mises en cache 3 jours) ---------- */
async function getSets() {
  if (state.sets) return state.sets;
  const cached = load("sets", null);
  if (cached && Date.now() - cached.t < 3 * 864e5) return useSets(cached.v);
  try {
    const v = await api("/sets");
    save("sets", { t: Date.now(), v });
    return useSets(v);
  } catch (e) {
    if (cached) return useSets(cached.v);
    throw e;
  }
}
// Les extensions du jeu mobile TCG Pocket (A1, A2a, B1, P-A…) ne sont pas des cartes physiques.
const isPocket = (id) => /^[AB]\d|^P-[A-Z]$/.test(String(id));
function useSets(v) {
  v = v.filter((s) => !isPocket(s.id));
  state.sets = v;
  state.counts = new Set(v.map((s) => s.cardCount?.official).filter(Boolean));
  return v;
}

async function findByNumber(n, total) {
  const sets = (await getSets()).filter((s) => s.cardCount?.official === total);
  const found = await Promise.all(sets.map((s) => api(`/sets/${encodeURIComponent(s.id)}/${n}`).catch(() => null)));
  return found.filter(Boolean);
}

/* ---------- Lecture du texte (OCR) ---------- */
// Lit « 4/102 », « 006/165 », « 199/198 »… et ne garde qu'un total qui existe vraiment.
function parseNumber(text, counts) {
  const clean = text.replace(/[Oo]/g, "0").replace(/[|Il]/g, "1").replace(/\\/g, "/");
  for (const m of clean.matchAll(/(\d{1,3})\s*\/\s*(\d{2,3})/g)) {
    const n = parseInt(m[1], 10), t = parseInt(m[2], 10);
    if (n > 0 && (!counts || counts.has(t)) && n <= t + 150) return { n, t };
  }
  return null;
}

function norm(s) {
  return String(s).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z]/g, "");
}
// Similarité de Dice sur les bigrammes : tolère les fautes de lecture.
function similarity(a, b) {
  a = norm(a); b = norm(b);
  if (!a || !b) return 0;
  if (a.includes(b) || b.includes(a)) return 1;
  const grams = (s) => { const m = new Map(); for (let i = 0; i < s.length - 1; i++) { const g = s.slice(i, i + 2); m.set(g, (m.get(g) || 0) + 1); } return m; };
  const A = grams(a), B = grams(b); let inter = 0;
  for (const [g, c] of A) inter += Math.min(c, B.get(g) || 0);
  return (2 * inter) / (a.length - 1 + b.length - 1 || 1);
}

// Lecteur limité aux chiffres et à « / », en mode « bloc de texte » : le réglage qui a le mieux
// lu les numéros sur de vraies photos de cartes.
async function getNumWorker() {
  if (!state.numWorker) {
    state.numWorker = (async () => {
      const w = await Tesseract.createWorker("eng");
      await w.setParameters({ tessedit_char_whitelist: "0123456789/", tessedit_pageseg_mode: "6" });
      return w;
    })();
  }
  return state.numWorker;
}
async function getNameWorker() {
  if (!state.nameWorker) state.nameWorker = Tesseract.createWorker("fra").then(async (w) => { await w.setParameters({ tessedit_pageseg_mode: "6" }); return w; });
  return state.nameWorker;
}

// Rectangle du cadre, converti en pixels de la vidéo (la vidéo est en object-fit: cover).
function frameRectInVideo() {
  const vr = video.getBoundingClientRect(), fr = frame.getBoundingClientRect();
  const vw = video.videoWidth, vh = video.videoHeight;
  const s = Math.max(vr.width / vw, vr.height / vh);
  const ox = (vw * s - vr.width) / 2, oy = (vh * s - vr.height) / 2;
  return { x: (fr.left - vr.left + ox) / s, y: (fr.top - vr.top + oy) / s, w: fr.width / s, h: fr.height / s };
}

// Instantané de la carte en pleine résolution (jusqu'à 1600 px de large) : le numéro est minuscule,
// chaque pixel compte.
function snapshot(source, rect, maxW = 1600) {
  const c = document.createElement("canvas");
  const w = Math.max(600, Math.min(maxW, Math.round(rect.w)));
  c.width = w; c.height = Math.round(w * rect.h / rect.w);
  c.getContext("2d").drawImage(source, rect.x, rect.y, rect.w, rect.h, 0, 0, c.width, c.height);
  return c;
}

// Zone de l'instantané (fractions), agrandie (scale), en niveaux de gris.
function strip(snap, top, height, scale = 2, invert = false, left = 0, w = 1) {
  const sx = snap.width * left, sw = snap.width * w;
  const sy = snap.height * top, sh = snap.height * height;
  const c = document.createElement("canvas");
  const width = Math.min(2000, Math.round(sw * scale));
  c.width = width; c.height = Math.round(sh * width / sw);
  const ctx = c.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(snap, sx, sy, sw, sh, 0, 0, c.width, c.height);
  const d = ctx.getImageData(0, 0, c.width, c.height), p = d.data;
  for (let i = 0; i < p.length; i += 4) {
    let g = 0.299 * p[i] + 0.587 * p[i + 1] + 0.114 * p[i + 2];
    if (invert) g = 255 - g;
    p[i] = p[i + 1] = p[i + 2] = g;
  }
  ctx.putImageData(d, 0, 0);
  return c;
}

// Plusieurs façons de lire le numéro ; aucune ne marche sur toutes les cartes.
// `only` limite aux essais donnés (le scan auto en fait deux par image, à tour de rôle).
async function readNumber(snap, only) {
  await getSets();
  const digits = await getNumWorker();
  const tries = [
    // Toute la bande du bas
    () => digits.recognize(strip(snap, 0.84, 0.13, 2)),
    // Moitié gauche (cartes récentes) et droite (anciennes cartes), zoomées
    () => digits.recognize(strip(snap, 0.84, 0.13, 2, false, 0, 0.5)),
    () => digits.recognize(strip(snap, 0.84, 0.13, 3, false, 0.5, 0.5)),
    // En négatif, pour le texte clair sur fond sombre (cartes full art)
    () => digits.recognize(strip(snap, 0.84, 0.13, 2, true)),
  ];
  for (const i of only || tries.keys()) {
    const r = parseNumber((await tries[i]()).data.text, state.counts);
    if (r) return r;
  }
  return null;
}

/* ---------- Reconnaissance par IA (optionnelle, clé API Anthropic) ---------- */
const AI_PROMPT = `Tu identifies une carte Pokémon (souvent en français) sur une photo.
Réponds UNIQUEMENT avec un objet JSON, sans texte autour :
{"name": "nom exact imprimé en haut de la carte", "number": "numéro avant la barre, ex. 006", "total": "nombre après la barre, ex. 165, ou null", "set": "nom de l'extension si tu le reconnais, sinon null"}
Le numéro est imprimé en petit en bas de la carte (ex. « 006/165 »). Si ce n'est pas une carte Pokémon, renvoie {"name": null}.`;

async function aiIdentify(snap) {
  const key = load("apikey", "");
  if (!key) return null;
  // Image réduite à 1000 px : assez pour l'IA, moins cher à envoyer.
  const small = snapshot(snap, { x: 0, y: 0, w: snap.width, h: snap.height }, 1000);
  const jpeg = small.toDataURL("image/jpeg", 0.85).split(",")[1];
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 20000);
  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      signal: ctrl.signal,
      headers: {
        "content-type": "application/json",
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
        "anthropic-dangerous-direct-browser-access": "true",
      },
      body: JSON.stringify({
        model: "claude-haiku-5-5",
        max_tokens: 200,
        messages: [{ role: "user", content: [
          { type: "image", source: { type: "base64", media_type: "image/jpeg", data: jpeg } },
          { type: "text", text: AI_PROMPT },
        ] }],
      }),
    });
    if (r.status === 401) throw new Error("Clé API refusée : vérifie-la dans les réglages");
    if (r.status === 400 || r.status === 402) throw new Error("IA : crédit épuisé ou compte à activer sur console.anthropic.com");
    if (!r.ok) throw new Error("L'IA a répondu " + r.status);
    const data = await r.json();
    const txt = data.content?.map((b) => b.text || "").join("") || "";
    const m = txt.match(/\{[\s\S]*\}/);
    return m ? JSON.parse(m[0]) : null;
  } catch (e) {
    if (e.name === "AbortError") throw new Error("L'IA met trop de temps, réessaie");
    throw e;
  } finally { clearTimeout(timer); }
}

// Transforme la réponse de l'IA en carte(s) TCGdex.
async function cardsFromAI(ai) {
  if (!ai?.name && !ai?.number) return [];
  const n = parseInt(String(ai.number || "").replace(/\D/g, ""), 10);
  const t = parseInt(String(ai.total || "").replace(/\D/g, ""), 10);
  if (n && t) {
    let cards = await findByNumber(n, t);
    if (cards.length > 1 && ai.name) {
      const best = cards.filter((c) => similarity(c.name, ai.name) >= 0.6);
      if (best.length) cards = best;
      if (cards.length > 1 && ai.set) {
        const bySet = cards.filter((c) => similarity(c.set?.name || "", ai.set) >= 0.6);
        if (bySet.length) cards = bySet;
      }
    }
    if (cards.length) return cards;
  }
  if (!ai.name) return [];
  const p = new URLSearchParams({ name: ai.name, "pagination:itemsPerPage": "40", "pagination:page": "1" });
  if (n) p.set("localId", `eq:${n}|${String(n).padStart(2, "0")}|${String(n).padStart(3, "0")}`);
  return ((await api("/cards?" + p)) || []).filter((c) => !isPocket(c.id.split("-")[0]));
}

async function identifyWithAI(snap) {
  hint("Analyse par l'IA…");
  const ai = await aiIdentify(snap);
  const cards = await cardsFromAI(ai);
  if (!cards.length) return false;
  buzz(40);
  frame.classList.add("hit"); setTimeout(() => frame.classList.remove("hit"), 900);
  if (cards.length === 1) showCard(cards[0].pricing ? cards[0] : await api(`/cards/${encodeURIComponent(cards[0].id)}`));
  else showPicker(cards, ai.name || "");
  hint("Mode IA : tiens la carte immobile une seconde dans le cadre");
  return true;
}

async function readName(snap) {
  try {
    const w = await getNameWorker();
    const { data } = await w.recognize(strip(snap, 0.015, 0.11, 1.5));
    return data.text;
  } catch { return ""; }
}

/* ---------- Identification ---------- */
async function identify(num, snap) {
  hint(`Recherche de <span class="num">${num.n}/${num.t}</span>…`);
  let cards;
  try { cards = await findByNumber(num.n, num.t); }
  catch (e) { hint(esc(e.message)); return; }
  if (!cards.length) { hint(`<span class="num">${num.n}/${num.t}</span> introuvable, réessaie ou cherche à la main`); return; }

  if (cards.length > 1 && snap) {
    hint("Plusieurs extensions possibles, lecture du nom…");
    const text = await readName(snap);
    const lines = text.split("\n").filter((l) => l.trim().length > 2);
    const scored = cards.map((c) => ({ c, s: Math.max(0, ...lines.map((l) => similarity(l, c.name))) }))
      .sort((a, b) => b.s - a.s);
    if (scored[0].s >= 0.55 && scored[0].s - (scored[1]?.s ?? 0) >= 0.15) cards = [scored[0].c];
  }
  buzz(40);
  frame.classList.add("hit"); setTimeout(() => frame.classList.remove("hit"), 900);
  if (cards.length === 1) showCard(cards[0]);
  else showPicker(cards, `${num.n}/${num.t}`);
  hint("Remplis le cadre avec la carte, sans lampe ni reflet sur le numéro");
}

/* ---------- Caméra ---------- */
async function startCamera() {
  $("camerror").hidden = true;
  if (!navigator.mediaDevices?.getUserMedia) return cameraError("Ce navigateur ne donne pas accès à la caméra. Ouvre l'appli en HTTPS, ou prends la carte en photo.");
  try {
    const s = await navigator.mediaDevices.getUserMedia({
      audio: false,
      // On demande la 4K : le téléphone donne la meilleure résolution qu'il sait faire.
      video: { facingMode: { ideal: "environment" }, width: { ideal: 3840 }, height: { ideal: 2160 } },
    });
    state.stream = s; state.track = s.getVideoTracks()[0];
    video.srcObject = s;
    await video.play().catch(() => {});
    const caps = state.track.getCapabilities?.() || {};
    $("torch").hidden = !caps.torch;
    if (caps.focusMode?.includes("continuous")) state.track.applyConstraints({ advanced: [{ focusMode: "continuous" }] }).catch(() => {});
    getSets().catch(() => {});
    getNumWorker().catch(() => {});
  } catch (e) {
    cameraError(e.name === "NotAllowedError"
      ? "L'accès à la caméra a été refusé. Autorise-le dans les réglages du navigateur, ou prends la carte en photo."
      : "Impossible d'ouvrir la caméra (" + e.name + "). Tu peux prendre la carte en photo.");
  }
}
function cameraError(msg) { $("camerror-msg").textContent = msg; $("camerror").hidden = false; }

async function scanOnce(manual) {
  if (state.busy || !video.videoWidth) return;
  state.busy = true;
  frame.classList.add("reading");
  try {
    const snap = snapshot(video, frameRectInVideo());
    // Gros bouton + clé API : l'IA d'abord (plus fiable), la lecture locale en secours.
    if (manual && load("apikey", "")) {
      try { if (await identifyWithAI(snap)) return; }
      catch (e) { toast(e.message); }
    }
    state.cycle = (state.cycle + 1) % 2;
    const num = await readNumber(snap, manual ? null : state.cycle ? [0, 1] : [0, 2, 3]);
    const now = Date.now();
    if (!num) {
      if (manual) hint(load("apikey", "")
        ? "Carte non reconnue : rapproche-la, évite les reflets, ou cherche à la main"
        : "Numéro illisible : rapproche la carte, coupe la lampe, incline-la pour enlever le reflet");
      else if (now - state.lastHit > 6000 && state.reads.length === 0)
        hint("Numéro pas encore lu : rapproche la carte, coupe la lampe, incline-la contre les reflets");
      return;
    }
    state.lastHit = now;
    if (manual) { state.reads = []; await identify(num, snap); return; }
    // En mode auto, on vote : le premier numéro lu deux fois en 8 secondes l'emporte,
    // même si des lectures ratées ou fausses s'intercalent.
    const key = num.n + "/" + num.t;
    state.reads = state.reads.filter((r) => now - r.t < 8000);
    state.reads.push({ key, num, t: now });
    if (state.reads.filter((r) => r.key === key).length >= 2) { state.reads = []; await identify(num, snap); }
    else hint(`Lu <span class="num">${key}</span>, ne bouge plus…`);
  } catch (e) {
    console.warn(e);
    if (manual) hint("Erreur de lecture : " + esc(e.message));
  } finally {
    frame.classList.remove("reading");
    state.busy = false;
  }
}

/* Scan auto avec l'IA : on attend que la carte soit immobile ~0,7 s, on envoie UNE image,
   puis on attend que la scène change (nouvelle carte) avant d'en renvoyer une. */
const aiScan = { prev: null, stableSince: 0, armed: true, lastSent: null, broken: false, busy: false };
function thumb() {
  const c = aiScan.canvas || (aiScan.canvas = document.createElement("canvas"));
  c.width = 24; c.height = 34;
  const r = frameRectInVideo();
  const ctx = c.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(video, r.x, r.y, r.w, r.h, 0, 0, 24, 34);
  const d = ctx.getImageData(0, 0, 24, 34).data, g = new Float32Array(24 * 34);
  for (let i = 0, j = 0; i < d.length; i += 4, j++) g[j] = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
  return g;
}
const meanDiff = (a, b) => { let s = 0; for (let i = 0; i < a.length; i++) s += Math.abs(a[i] - b[i]); return s / a.length; };
const spread = (a) => { const m = a.reduce((s, v) => s + v, 0) / a.length; return Math.sqrt(a.reduce((s, v) => s + (v - m) ** 2, 0) / a.length); };

async function aiAutoStep() {
  if (aiScan.busy) return;
  const t = thumb(), now = Date.now();
  const moving = aiScan.prev ? meanDiff(t, aiScan.prev) > 7 : true;
  aiScan.prev = t;
  if (aiScan.lastSent && meanDiff(t, aiScan.lastSent) > 22) aiScan.armed = true; // nouvelle carte ou cadre vidé
  if (moving) { aiScan.stableSince = 0; return; }
  aiScan.stableSince ||= now;
  if (!aiScan.armed || now - aiScan.stableSince < 700 || spread(t) < 20) return;
  aiScan.armed = false; aiScan.lastSent = t; aiScan.busy = true;
  frame.classList.add("reading");
  try {
    const snap = snapshot(video, frameRectInVideo());
    if (!(await identifyWithAI(snap))) hint("Pas de carte reconnue. Bouge un peu la carte pour réessayer.");
  } catch (e) {
    toast(e.message);
    if (/Clé API|401|crédit/i.test(e.message)) { aiScan.broken = true; hint("IA indisponible : lecture locale du numéro."); }
  } finally {
    frame.classList.remove("reading");
    aiScan.busy = false;
  }
}

async function autoLoop() {
  const canRun = state.auto && !anySheetOpen() && !document.hidden && video.videoWidth && Date.now() > state.pausedUntil;
  if (canRun) {
    if (load("apikey", "") && !aiScan.broken) await aiAutoStep();
    else await scanOnce(false);
  }
  setTimeout(autoLoop, canRun ? 200 : 500);
}

async function scanPhoto(file) {
  if (!file) return;
  const im = new Image();
  im.src = URL.createObjectURL(file);
  try { await im.decode(); } catch { return toast("Image illisible"); }
  hint("Lecture de la photo…");
  // Sur une photo, on suppose que la carte remplit l'image.
  const snap = snapshot(im, { x: 0, y: 0, w: im.naturalWidth, h: im.naturalHeight });
  try {
    if (load("apikey", "")) {
      try { if (await identifyWithAI(snap)) return; } catch (e) { toast(e.message); }
    }
    const num = await readNumber(snap);
    if (num) return identify(num, snap);
    hint("Numéro illisible sur la photo. Cadre la carte au plus près, ou cherche à la main.");
  } catch (e) { hint("Erreur : " + esc(e.message)); }
}

/* ---------- Tiroirs ---------- */
const sheets = ["sheet-card", "sheet-pick", "sheet-search", "sheet-lot", "sheet-settings"];
function anySheetOpen() { return sheets.some((id) => $(id).classList.contains("open")); }
function openSheet(id) {
  sheets.forEach((s) => $(s).classList.toggle("open", s === id));
  $("backdrop").classList.add("on");
  $(id).scrollTop = 0;
}
function closeSheets() {
  sheets.forEach((s) => $(s).classList.remove("open"));
  $("backdrop").classList.remove("on");
  state.pausedUntil = Date.now() + 1200; // laisse le temps de retirer la carte
  state.reads = [];
  state.lastHit = Date.now();
}
$("backdrop").addEventListener("click", closeSheets);
document.addEventListener("click", (e) => { if (e.target.closest("[data-close]")) closeSheets(); });

/* ---------- Fiche carte ---------- */
function priceOf(c) {
  const cm = c.pricing?.cardmarket;
  if (!cm) return null;
  return cm.trend || cm.avg || cm["trend-holo"] || cm.avg30 || null;
}

function trendHTML(cm) {
  const pts = [["30 jours", cm.avg30], ["7 jours", cm.avg7], ["24 h", cm.avg1]];
  const max = Math.max(...pts.map((p) => p[1] || 0));
  if (!max) return "";
  let delta = "";
  if (cm.avg30 && cm.avg7) {
    const d = (cm.avg7 - cm.avg30) / cm.avg30 * 100;
    delta = `<span class="delta ${d >= 0 ? "up" : "down"}">${d >= 0 ? "▲" : "▼"} ${Math.abs(d).toFixed(0)} % vs 30 j</span>`;
  }
  const bars = pts.map(([l, v]) => `<div class="bar"><span class="v num">${eur(v)}</span>
    <div class="fill" style="height:${v ? Math.max(5, v / max * 72) : 2}%"></div><span>${l}</span></div>`).join("");
  return `<div class="sect"><div class="sect-h"><span class="label">Moyenne des ventes Cardmarket</span>${delta}</div><div class="trend">${bars}</div></div>`;
}

function variantsHTML(c) {
  const seen = new Set(), rows = [];
  for (const v of c.variants_detailed || []) {
    const cm = v.pricing?.cardmarket;
    if (!cm || seen.has(cm.idProduct)) continue;
    seen.add(cm.idProduct);
    const label = [v.type, v.subtype, ...(v.stamp || [])].filter(Boolean).join(" · ");
    rows.push(`<tr><td>${esc(label)}</td><td class="num">${eur(cm.trend || cm.avg)}</td><td class="num">${eur(cm.low)}</td></tr>`);
  }
  if (rows.length < 2) return "";
  return `<div class="sect"><span class="label">Selon la version</span><div class="tablewrap"><table>
    <thead><tr><th>Version</th><th>Tendance</th><th>Plus bas</th></tr></thead><tbody>${rows.join("")}</tbody></table></div></div>`;
}

function tablesHTML(c) {
  const cm = c.pricing?.cardmarket, tp = c.pricing?.tcgplayer;
  let out = "";
  if (cm) {
    const rows = [["Tendance", "trend"], ["Prix moyen", "avg"], ["Plus bas en vente", "low"]]
      .map(([l, k]) => `<tr><td>${l}</td><td class="num">${eur(cm[k])}</td><td class="num">${eur(cm[k + "-holo"])}</td></tr>`).join("");
    out += `<div class="tablewrap"><table><thead><tr><th>Cardmarket</th><th>Normale</th><th>Reverse</th></tr></thead><tbody>${rows}</tbody></table></div>`;
  }
  if (tp) {
    const names = { normal: "Normale", reverse: "Reverse", "reverse-holofoil": "Reverse", holo: "Holo", holofoil: "Holo", "1st-edition": "1re édition", "1st-edition-holofoil": "1re éd. holo", unlimited: "Illimitée", "unlimited-holofoil": "Illimitée holo" };
    const rows = Object.entries(tp).filter(([, v]) => v && typeof v === "object" && "marketPrice" in v)
      .map(([k, v]) => `<tr><td>${names[k] || esc(k)}</td><td class="num">${usd(v.marketPrice)}</td><td class="num">${usd(v.lowPrice)}</td></tr>`).join("");
    if (rows) out += `<div class="tablewrap"><table><thead><tr><th>TCGplayer (US)</th><th>Marché</th><th>Plus bas</th></tr></thead><tbody>${rows}</tbody></table></div>`;
  }
  return out;
}

function linksHTML(c) {
  const official = c.set?.cardCount?.official;
  const q = `${c.name} ${c.localId}${official ? "/" + official : ""}`;
  const e = encodeURIComponent;
  const links = [
    ["eBay · ventes réussies", `https://www.ebay.fr/sch/i.html?_nkw=${e(q)}&LH_Sold=1&LH_Complete=1&_sop=13`],
    ["Cardmarket", `https://www.cardmarket.com/fr/Pokemon/Products/Search?searchString=${e(c.name + " " + (c.set?.name || ""))}`],
    ["Vinted", `https://www.vinted.fr/catalog?search_text=${e(q)}`],
    ["Leboncoin", `https://www.leboncoin.fr/recherche?text=${e(q)}`],
  ];
  return links.map(([l, u]) => `<a class="btn" href="${u}" target="_blank" rel="noopener">${l}</a>`).join("");
}

function verdict(asked, ref) {
  if (!asked || !ref) return { cls: "", text: "Tape le prix du vendeur pour savoir si c'est une affaire." };
  const r = asked / ref;
  const pct = Math.round((1 - r) * 100);
  if (r <= 0.7) return { cls: "good", text: `Bonne affaire : ${pct} % sous le prix Cardmarket` };
  if (r <= 1.05) return { cls: "ok", text: r <= 1 ? `Prix correct : ${pct} % sous Cardmarket` : "Prix correct, au niveau de Cardmarket" };
  return { cls: "bad", text: `Trop cher : ${Math.round((r - 1) * 100)} % au-dessus de Cardmarket` };
}

function showCard(c) {
  state.current = c;
  const price = priceOf(c);
  const cm = c.pricing?.cardmarket;
  const official = c.set?.cardCount?.official;
  $("card-body").innerHTML = `
    <div class="sheet-head"><span class="label">Carte trouvée</span><button class="iconbtn close" data-close aria-label="Fermer">✕</button></div>
    <div class="card-top">
      <img src="${img(c.image, "high")}" alt="" onerror="this.style.visibility='hidden'">
      <div class="meta">
        <h2>${esc(c.name)}</h2>
        <div class="chips">
          <span class="chip">${esc(c.set?.name || "?")}</span>
          <span class="chip num">${esc(c.localId)}${official ? "/" + official : ""}</span>
          ${c.rarity ? `<span class="chip">${esc(c.rarity)}</span>` : ""}
        </div>
        <div class="tag"><b class="num">${eur(price)}</b><small>Tendance Cardmarket</small></div>
        ${cm?.updated ? `<span class="updated">Prix du ${new Date(cm.updated).toLocaleDateString("fr-FR")}</span>` : `<span class="updated">Pas de prix Cardmarket pour cette carte</span>`}
      </div>
    </div>
    <div class="verdict">
      <label class="label" for="asked">Prix demandé par le vendeur</label>
      <div class="row"><input id="asked" type="text" inputmode="decimal" placeholder="ex. 5" autocomplete="off"><span class="label">€</span></div>
      <span class="out" id="verdict-out">${verdict(null, price).text}</span>
    </div>
    <div class="actions">
      <button class="btn primary" id="add-lot">Ajouter au lot</button>
      <button class="btn" data-close>Scanner la suivante</button>
    </div>
    <button class="linkbtn" id="wrong-card">Ce n'est pas la bonne carte ?</button>
    ${cm ? trendHTML(cm) : ""}
    ${variantsHTML(c)}
    ${tablesHTML(c)}
    <div class="sect"><span class="label">Dernières ventes et annonces</span><div class="links">${linksHTML(c)}</div></div>`;
  const askedEl = $("asked");
  askedEl.addEventListener("input", () => {
    const v = parseFloat(askedEl.value.replace(",", "."));
    const out = verdict(isNaN(v) ? null : v, price);
    const el = $("verdict-out"); el.textContent = out.text; el.className = "out " + out.cls;
  });
  $("wrong-card").addEventListener("click", () => {
    $("s-name").value = c.name; $("s-num").value = "";
    $("search-results").innerHTML = "";
    $("search-status").textContent = "Corrige le nom ou ajoute le numéro, puis cherche.";
    openSheet("sheet-search");
  });
  $("add-lot").addEventListener("click", () => {
    const v = parseFloat(askedEl.value.replace(",", "."));
    state.lot.unshift({ id: c.id, name: c.name, num: `${c.localId}${official ? "/" + official : ""}`, set: c.set?.name || "", image: c.image, price, asked: isNaN(v) ? null : v });
    save("lot", state.lot); renderLot();
    toast(`${c.name} ajouté au lot`);
    closeSheets();
  });
  openSheet("sheet-card");
}

async function showCardById(id) {
  try { const c = await api(`/cards/${encodeURIComponent(id)}`); if (c) showCard(c); else toast("Carte introuvable"); }
  catch (e) { toast(e.message); }
}

function pickButton(c, onPick) {
  const b = document.createElement("button");
  b.className = "pick"; b.type = "button";
  const im = document.createElement("img"); im.alt = ""; im.src = img(c.image);
  const n = document.createElement("b"); n.textContent = c.name;
  const s = document.createElement("span"); s.textContent = [c.set?.name, c.localId].filter(Boolean).join(" · ");
  b.append(im, n, s);
  b.addEventListener("click", onPick);
  return b;
}

function showPicker(cards, label) {
  $("pick-title").textContent = `Quelle carte ${label} ?`;
  const box = $("picks"); box.innerHTML = "";
  cards.forEach((c) => box.append(pickButton(c, () => showCard(c))));
  openSheet("sheet-pick");
}

/* ---------- Recherche manuelle ---------- */
$("search-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const name = $("s-name").value.trim();
  const rawNum = $("s-num").value.trim();
  const status = $("search-status"), box = $("search-results");
  box.innerHTML = ""; status.classList.remove("err");
  if (!name && !rawNum) { status.textContent = "Indique un nom, un numéro, ou les deux."; status.classList.add("err"); return; }
  status.textContent = "Recherche…";
  try {
    const full = parseNumber(rawNum, null);
    let cards;
    if (full) {
      cards = await findByNumber(full.n, full.t);
      if (name && cards.length > 1) {
        const f = cards.filter((c) => similarity(c.name, name) >= 0.5);
        if (f.length) cards = f;
      }
    } else {
      const p = new URLSearchParams({ "pagination:itemsPerPage": "60", "pagination:page": "1" });
      if (name) p.set("name", name);
      if (/^\d{1,3}$/.test(rawNum)) { const n = String(parseInt(rawNum, 10)); p.set("localId", `eq:${n}|${n.padStart(2, "0")}|${n.padStart(3, "0")}`); }
      cards = ((await api("/cards?" + p)) || []).filter((c) => !isPocket(c.id.split("-")[0]));
    }
    if (!cards.length) { status.textContent = "Aucune carte trouvée. Vérifie l'orthographe (nom français)."; status.classList.add("err"); return; }
    status.textContent = `${cards.length} résultat${cards.length > 1 ? "s" : ""}${cards.length >= 60 ? " (affine avec le numéro)" : ""}`;
    cards.forEach((c) => box.append(pickButton(c, () => c.pricing ? showCard(c) : showCardById(c.id))));
  } catch (err) {
    status.textContent = err.message; status.classList.add("err");
  }
});

/* ---------- Lot ---------- */
function renderLot() {
  $("lot-count").textContent = state.lot.length;
  const value = state.lot.reduce((s, x) => s + (x.price || 0), 0);
  const askedItems = state.lot.filter((x) => x.asked != null);
  const asked = askedItems.reduce((s, x) => s + x.asked, 0);
  $("lot-value").textContent = eur(value);
  $("lot-asked").textContent = askedItems.length ? eur(asked) : "—";
  const v = askedItems.length === state.lot.length && state.lot.length ? verdict(asked, value) : null;
  const vEl = $("lot-verdict");
  vEl.textContent = v ? v.text : state.lot.length ? "Ajoute le prix demandé de chaque carte pour comparer le lot entier." : "";
  vEl.style.color = v ? `var(--${v.cls === "good" ? "good" : v.cls === "ok" ? "ok" : "bad"})` : "";
  const list = $("lot-list"); list.innerHTML = "";
  if (!state.lot.length) { list.innerHTML = `<p class="empty">Aucune carte. Scanne une carte puis touche « Ajouter au lot ».</p>`; }
  state.lot.forEach((x, i) => {
    const row = document.createElement("div"); row.className = "lot-item";
    row.innerHTML = `<img alt="" src="${img(x.image)}"><div class="who"><b></b><span></span></div>
      <span class="num">${eur(x.price)}</span><button class="rm" aria-label="Retirer">✕</button>`;
    row.querySelector("b").textContent = x.name;
    row.querySelector(".who span").textContent = `${x.num} · ${x.set}${x.asked != null ? " · demandé " + eur(x.asked) : ""}`;
    row.querySelector(".who").addEventListener("click", () => showCardById(x.id));
    row.querySelector(".rm").addEventListener("click", () => { state.lot.splice(i, 1); save("lot", state.lot); renderLot(); });
    list.append(row);
  });
  $("lot-clear").hidden = !state.lot.length;
}
let clearArmed = false;
$("lot-clear").addEventListener("click", () => {
  if (!clearArmed) { clearArmed = true; $("lot-clear").textContent = "Touche encore pour tout effacer"; setTimeout(() => { clearArmed = false; $("lot-clear").textContent = "Vider le lot"; }, 3000); return; }
  clearArmed = false; $("lot-clear").textContent = "Vider le lot";
  state.lot = []; save("lot", state.lot); renderLot();
});

/* ---------- Boutons ---------- */
// Gros bouton : flash dans le cadre, ligne de scan qui balaie la carte, anneau qui tourne
// autour du bouton tant que l'analyse dure.
let manualScanning = false;
$("shutter").addEventListener("click", async () => {
  if (!$("camerror").hidden) return $("photo").click();
  if (manualScanning) return;
  manualScanning = true;
  const btn = $("shutter"), flash = $("flash");
  flash.classList.remove("go"); void flash.offsetWidth; flash.classList.add("go");
  buzz(15);
  btn.classList.add("busy"); btn.setAttribute("aria-busy", "true");
  frame.classList.add("scanning");
  hint("Scan en cours…");
  try {
    // Si le scan auto est en train de lire, on attend qu'il ait fini plutôt que d'ignorer l'appui.
    for (let i = 0; (state.busy || aiScan.busy) && i < 60; i++) await new Promise((r) => setTimeout(r, 50));
    state.pausedUntil = Date.now() + 60000; // le scan auto se met en pause pendant le scan manuel
    await scanOnce(true);
  } finally {
    state.pausedUntil = Date.now() + 800;
    btn.classList.remove("busy"); btn.removeAttribute("aria-busy");
    frame.classList.remove("scanning");
    manualScanning = false;
  }
});
function setAuto(on) { state.auto = on; save("auto", on); $("auto").setAttribute("aria-pressed", on); }
$("auto").addEventListener("click", () => { setAuto(!state.auto); toast(state.auto ? "Scan automatique activé" : "Scan automatique coupé : utilise le gros bouton"); });
$("torch").addEventListener("click", async () => {
  state.torch = !state.torch;
  try { await state.track.applyConstraints({ advanced: [{ torch: state.torch }] }); $("torch").setAttribute("aria-pressed", state.torch); }
  catch { state.torch = false; toast("Lampe indisponible"); }
});
$("open-search").addEventListener("click", () => { openSheet("sheet-search"); setTimeout(() => $("s-name").focus(), 300); });
$("open-lot").addEventListener("click", () => { renderLot(); openSheet("sheet-lot"); });
$("photo").addEventListener("change", (e) => scanPhoto(e.target.files[0]));

/* ---------- Réglages : clé API ---------- */
function refreshKeyUI() {
  const has = !!load("apikey", "");
  if (typeof aiScan !== "undefined") { aiScan.broken = false; aiScan.armed = true; }
  hint(has ? "Mode IA : tiens la carte immobile une seconde dans le cadre" : "Remplis le cadre avec la carte, sans lampe ni reflet sur le numéro");
  $("open-settings").classList.toggle("ai", has);
  $("key-status").textContent = has ? "IA activée : le gros bouton utilise Claude." : "Aucune clé : lecture locale gratuite uniquement.";
  $("key-status").classList.remove("err");
}
$("open-settings").addEventListener("click", () => { $("apikey").value = load("apikey", ""); refreshKeyUI(); openSheet("sheet-settings"); });
$("key-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const k = $("apikey").value.trim();
  const st = $("key-status");
  if (!k.startsWith("sk-ant-")) { st.textContent = "Une clé Anthropic commence par « sk-ant- »."; st.classList.add("err"); return; }
  st.classList.remove("err"); st.textContent = "Vérification de la clé…";
  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": k, "anthropic-version": "2023-06-01", "anthropic-dangerous-direct-browser-access": "true" },
      body: JSON.stringify({ model: "claude-haiku-5-5", max_tokens: 5, messages: [{ role: "user", content: "Réponds OK" }] }),
    });
    if (!r.ok) {
      st.textContent = r.status === 401 ? "Clé refusée par Anthropic. Recopie-la en entier." : r.status === 400 ? "Clé valide mais crédit épuisé ou compte à activer." : "Erreur " + r.status + " pendant la vérification.";
      st.classList.add("err"); return;
    }
    save("apikey", k); refreshKeyUI(); toast("Clé enregistrée, IA activée");
  } catch { st.textContent = "Pas de réseau pour vérifier la clé."; st.classList.add("err"); }
});
$("key-remove").addEventListener("click", () => { save("apikey", ""); $("apikey").value = ""; refreshKeyUI(); toast("Clé supprimée"); });
$("retry-cam").addEventListener("click", startCamera);
document.addEventListener("visibilitychange", () => { if (!document.hidden && state.track?.readyState === "ended") startCamera(); });

/* ---------- Démarrage ---------- */
setAuto(state.auto);
renderLot();
refreshKeyUI();
startCamera().then(autoLoop);
if ("serviceWorker" in navigator && location.protocol === "https:") navigator.serviceWorker.register("sw.js").catch(() => {});

// Exposé pour les tests dans la console
window.PokeScan = { parseNumber, similarity, findByNumber, getSets, showCard, verdict };
