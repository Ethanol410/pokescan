/* Reconnaissance par modèle de vision (réseau de neurones LCNet + projection apprise, voir
 * tools/build_emb.py). Chaque carte de la base a une « signature » de 512 valeurs ; la photo est
 * passée dans le même modèle et comparée à toutes les signatures (produit scalaire).
 *
 * window.CardVision = { load(lang), ready, embed(source, rect), search(vecs, top), ranks(vecs, ids), meta }
 * Le moteur (onnxruntime-web) et le modèle sont servis par l'appli elle-même (vendor/, models/).
 */
(function () {
  "use strict";
  const V = { ready: false, loading: false, failed: null, meta: null, lang: null };
  let session = null, model = null, gallery = null, ids = null, names = null, count = 0, dim = 0;
  let cvA, cvB, cvC;

  function loadScript(src) {
    return new Promise((ok, ko) => {
      if (window.ort) return ok();
      const s = document.createElement("script"); s.src = src; s.onload = ok; s.onerror = () => ko(new Error("moteur indisponible"));
      document.head.append(s);
    });
  }
  async function getJSON(url, noCache) {
    const r = await fetch(url, noCache ? { cache: "no-cache" } : {});
    if (!r.ok) throw new Error(url + " : " + r.status);
    return r.json();
  }
  async function getBin(url) {
    const r = await fetch(url);
    if (!r.ok) throw new Error(url + " : " + r.status);
    return new Uint8Array(await r.arrayBuffer());
  }
  // Garde un seul fichier de chaque sorte (modèle, index par langue) dans le cache hors ligne.
  async function pruneCache(keep) {
    try {
      const c = await caches.open("pokescan-vision");
      for (const req of await c.keys()) {
        const p = new URL(req.url).pathname;
        const kind = p.match(/\/models\/card-/) ? "model" : (p.match(/\/index\/(\w+)\/emb-/) || [])[1];
        if (kind && !keep.some((k) => p.endsWith(k)) && (kind === "model" || kind === V.lang)) await c.delete(req);
      }
    } catch {}
  }

  async function load(lang = "fr") {
    if ((V.ready || V.loading) && V.lang === lang) return;
    V.loading = true; V.failed = null; V.ready = false; V.lang = lang;
    try {
      const [m, meta] = await Promise.all([getJSON("models/card.json", true), getJSON(`index/${lang}/emb.json`, true)]);
      if (meta.model !== m.file) throw new Error("index et modèle pas à jour ensemble");
      await loadScript("vendor/ort-1.19.2/ort.wasm.min.js");
      ort.env.wasm.wasmPaths = new URL("vendor/ort-1.19.2/", location.href).href;
      ort.env.wasm.numThreads = 1; // pas d'isolation multi-fils sur iPhone : un seul fil, plus simple
      if (!session || model !== m.file) {
        const bytes = await getBin("models/" + m.file);
        session = await ort.InferenceSession.create(bytes, { executionProviders: ["wasm"], graphOptimizationLevel: "all" });
        model = m.file;
      }
      const bin = await getBin(`index/${lang}/${meta.file}`);
      dim = meta.dim; count = meta.ids.length;
      if (bin.length !== count * dim) throw new Error("index incomplet");
      gallery = new Int8Array(bin.buffer, bin.byteOffset, bin.length);
      ids = meta.ids; names = meta.names;
      V.meta = { ...meta, model: m, ids: undefined, names: undefined };
      V.input = m.input || 224; V.mean = m.mean; V.std = m.std;
      V.ready = true;
      pruneCache([m.file, meta.file]);
    } catch (e) {
      V.failed = e.message || String(e);
      console.warn("Modèle de vision :", e);
    } finally { V.loading = false; }
  }

  // Image de la carte → tenseur 1×3×224×224 normalisé. Réduction par moitiés successives pour
  // éviter le crénelage (même principe que match.js).
  function tensor(source, rect) {
    const N = V.input;
    cvA ||= document.createElement("canvas"); cvB ||= document.createElement("canvas");
    cvC ||= document.createElement("canvas");
    let src = source, sx = rect.x, sy = rect.y, sw = rect.w, sh = rect.h, flip = false;
    while (sw > N * 2 || sh > N * 2) {
      const c = flip ? cvB : cvA; flip = !flip;
      c.width = Math.max(N, Math.round(sw / 2)); c.height = Math.max(N, Math.round(sh / 2));
      const x = c.getContext("2d"); x.imageSmoothingEnabled = true; x.imageSmoothingQuality = "high";
      x.drawImage(src, sx, sy, sw, sh, 0, 0, c.width, c.height);
      src = c; sx = 0; sy = 0; sw = c.width; sh = c.height;
    }
    cvC.width = N; cvC.height = N;
    const ctx = cvC.getContext("2d", { willReadFrequently: true });
    ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = "high";
    ctx.drawImage(src, sx, sy, sw, sh, 0, 0, N, N);
    const px = ctx.getImageData(0, 0, N, N).data, out = new Float32Array(3 * N * N), P = N * N;
    const [m0, m1, m2] = V.mean, [s0, s1, s2] = V.std;
    for (let i = 0, j = 0; i < P; i++, j += 4) {
      out[i] = (px[j] / 255 - m0) / s0;
      out[P + i] = (px[j + 1] / 255 - m1) / s1;
      out[2 * P + i] = (px[j + 2] / 255 - m2) / s2;
    }
    return new ort.Tensor("float32", out, [1, 3, N, N]);
  }

  async function embed(source, rect) {
    if (!V.ready) return null;
    const feeds = { [session.inputNames[0]]: tensor(source, rect) };
    const out = (await session.run(feeds))[session.outputNames[0]].data;
    let n = 0; for (let i = 0; i < out.length; i++) n += out[i] * out[i];
    n = Math.sqrt(n) || 1;
    const v = new Float32Array(out.length); for (let i = 0; i < out.length; i++) v[i] = out[i] / n;
    return v;
  }

  // Similarité de chaque carte avec la photo : la meilleure des vues (cadrages) proposées.
  function sims(vecs) {
    const s = new Float32Array(count).fill(-9), sc = 1 / V.meta.scale;
    for (const v of vecs) {
      if (!v) continue;
      for (let k = 0, o = 0; k < count; k++, o += dim) {
        let d = 0;
        for (let j = 0; j < dim; j++) d += gallery[o + j] * v[j];
        d *= sc;
        if (d > s[k]) s[k] = d;
      }
    }
    return s;
  }

  // Meilleures cartes. gap = écart entre la 1re et la 1re carte d'un autre nom (les rééditions
  // d'une même illustration ont le même nom et se ressemblent forcément).
  function search(vecs, top = 8) {
    const s = sims(vecs), order = [];
    for (let k = 0; k < count; k++) {
      if (order.length < 64 || s[k] > s[order[order.length - 1]]) {
        order.push(k); order.sort((a, b) => s[b] - s[a]); if (order.length > 64) order.pop();
      }
    }
    const best = order[0], other = order.find((k) => names[k] !== names[best]);
    const res = order.slice(0, top).map((k) => ({ id: ids[k], name: names[k], s: s[k] }));
    return { results: res, best: res[0], gap: s[best] - (other != null ? s[other] : -1),
      same: order.filter((k) => names[k] === names[best] && s[best] - s[k] < 0.06).map((k) => ({ id: ids[k], name: names[k], s: s[k] })) };
  }

  // Rang (1 = la plus ressemblante) de cartes données parmi toute la base ; null si absente.
  function ranks(vecs, wanted) {
    const s = sims(vecs), pos = new Map(ids.map((id, k) => [id, k]));
    return wanted.map((id) => {
      const k = pos.get(id); if (k == null) return { id, rank: null, s: null };
      let r = 1; const v = s[k]; for (let i = 0; i < count; i++) if (s[i] > v) r++;
      return { id, rank: r, s: v };
    });
  }

  window.CardVision = Object.assign(V, { load, embed, search, ranks });
})();
