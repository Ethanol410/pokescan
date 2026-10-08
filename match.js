/* PokéScan — reconnaissance d'une carte par son image.
 *
 * Chaque carte est réduite à une empreinte de 12×16 pixels en couleur (4 bits par canal,
 * soit 288 octets). Pour reconnaître une carte filmée, on calcule la même empreinte et on
 * cherche la plus proche dans l'index, après avoir normalisé la luminosité et le contraste
 * de chaque canal et ignoré les pixels brûlés par un reflet.
 *
 * Ce fichier est utilisé à la fois par l'appli (window.CardMatch) et par le script qui
 * construit l'index (tools/build-index.mjs) : les deux calculent l'empreinte avec exactement
 * le même code, condition pour que la comparaison soit juste.
 */
(function (global) {
  "use strict";
  const W = 12, H = 16, N = W * H, BYTES = N * 3 / 2; // 288 octets par carte

  let mid, midCtx;
  function canvases() {
    if (!mid) {
      mid = make(96, 128); midCtx = mid.getContext("2d", { willReadFrequently: true });
    }
  }

  // Empreinte RGB 12×16 (Uint8Array de 576 valeurs) d'une zone d'une image, vidéo ou canvas.
  // La réduction se fait en deux étapes (96×128 puis 12×16) pour bien moyenner les pixels.
  // Version du calcul d'empreinte : l'index n'est réutilisé que s'il a été calculé de la même façon.
  const ALGO = 2;
  let stepA, stepB;
  const make = (w, h) => (typeof OffscreenCanvas !== "undefined" ? new OffscreenCanvas(w, h) : Object.assign(document.createElement("canvas"), { width: w, height: h }));

  // Empreinte RGB 12×16 (Uint8Array de 576 valeurs) d'une zone d'une image, vidéo ou canvas.
  // 1. Réduction par moitiés jusqu'à 192 px de large au plus (une moitié = moyenne exacte de 2×2 pixels).
  // 2. Tracé en 96×128.
  // 3. Moyenne exacte de blocs 8×8 calculée ici, et non par le navigateur : réduire d'un coup par 8
  //    fait sauter des pixels (surtout Safari) et rend l'empreinte instable.
  function describe(source, rect) {
    canvases();
    let r = rect || { x: 0, y: 0, w: source.videoWidth || source.width, h: source.videoHeight || source.height };
    let w = r.w, h = r.h, src = source, flip = false;
    while (w > 192) {
      w = Math.max(1, Math.round(w / 2)); h = Math.max(1, Math.round(h / 2));
      const c = flip ? (stepB ||= make(1, 1)) : (stepA ||= make(1, 1));
      c.width = w; c.height = h;
      const ctx = c.getContext("2d");
      ctx.drawImage(src, r.x, r.y, r.w, r.h, 0, 0, w, h);
      src = c; r = { x: 0, y: 0, w, h }; flip = !flip;
    }
    midCtx.drawImage(src, r.x, r.y, r.w, r.h, 0, 0, 96, 128);
    const d = midCtx.getImageData(0, 0, 96, 128).data;
    const o = new Uint8Array(N * 3);
    for (let by = 0; by < H; by++) for (let bx = 0; bx < W; bx++) {
      let sr = 0, sg = 0, sb = 0;
      for (let y = by * 8; y < by * 8 + 8; y++) for (let x = bx * 8; x < bx * 8 + 8; x++) {
        const i = (y * 96 + x) * 4; sr += d[i]; sg += d[i + 1]; sb += d[i + 2];
      }
      const j = (by * W + bx) * 3; o[j] = Math.round(sr / 64); o[j + 1] = Math.round(sg / 64); o[j + 2] = Math.round(sb / 64);
    }
    return o;
  }

  // 4 bits par valeur : deux valeurs par octet.
  function pack(rgb) {
    const o = new Uint8Array(BYTES);
    for (let i = 0; i < rgb.length; i += 2) o[i >> 1] = ((rgb[i] >> 4) << 4) | (rgb[i + 1] >> 4);
    return o;
  }
  function unpackAll(buf, count) {
    const all = new Uint8Array(count * N * 3);
    for (let i = 0; i < count * BYTES; i++) { const b = buf[i]; all[i * 2] = (b >> 4) * 17; all[i * 2 + 1] = (b & 15) * 17; }
    return all;
  }

  // Pixels utiles : on ignore ceux presque blancs (reflet de lampe ou de pochette).
  function glareMask(q) {
    const m = new Uint8Array(N);
    for (let p = 0; p < N; p++) m[p] = (q[p * 3] + q[p * 3 + 1] + q[p * 3 + 2]) / 3 < 235 ? 1 : 0;
    return m;
  }

  // Normalise chaque canal (moyenne 0, écart-type 1) sur les pixels du masque.
  function normalize(v, off, mask, out) {
    for (let ch = 0; ch < 3; ch++) {
      let s = 0, n = 0;
      for (let p = 0; p < N; p++) if (mask[p]) { s += v[off + p * 3 + ch]; n++; }
      const m = s / (n || 1);
      let q = 0;
      for (let p = 0; p < N; p++) if (mask[p]) { const d = v[off + p * 3 + ch] - m; q += d * d; }
      const sd = Math.sqrt(q / (n || 1)) || 1;
      for (let p = 0; p < N; p++) out[p * 3 + ch] = (v[off + p * 3 + ch] - m) / sd;
    }
    return out;
  }

  // Contours : différences de luminance entre pixels voisins (horizontaux puis verticaux).
  const EDGES = [];
  for (let y = 0; y < H; y++) for (let x = 0; x < W - 1; x++) EDGES.push(y * W + x, y * W + x + 1);
  for (let y = 0; y < H - 1; y++) for (let x = 0; x < W; x++) EDGES.push(y * W + x, (y + 1) * W + x);
  const NE = EDGES.length / 2;
  function edges(v, off, out) {
    const g = new Float32Array(N);
    for (let p = 0; p < N; p++) g[p] = 0.299 * v[off + p * 3] + 0.587 * v[off + p * 3 + 1] + 0.114 * v[off + p * 3 + 2];
    let m = 0;
    for (let k = 0; k < NE; k++) { out[k] = g[EDGES[2 * k + 1]] - g[EDGES[2 * k]]; m += out[k]; }
    m /= NE; let q = 0;
    for (let k = 0; k < NE; k++) q += (out[k] - m) ** 2;
    const sd = Math.sqrt(q / NE) || 1;
    for (let k = 0; k < NE; k++) out[k] = (out[k] - m) / sd;
    return out;
  }

  class Matcher {
    constructor(meta, buf) {
      this.ids = meta.ids; this.names = meta.names; this.count = meta.ids.length;
      this.rgb = unpackAll(buf, this.count);
      // Pré-normalisation sans masque, en entiers 8 bits : sert au premier tri rapide.
      const all = new Uint8Array(N).fill(1), tmp = new Float32Array(N * 3);
      this.pre = new Int8Array(this.count * N * 3);
      for (let i = 0; i < this.count; i++) {
        normalize(this.rgb, i * N * 3, all, tmp);
        for (let k = 0; k < N * 3; k++) this.pre[i * N * 3 + k] = Math.max(-127, Math.min(127, Math.round(tmp[k] * 32)));
      }
      // Contours de chaque carte, en entiers 8 bits.
      const e = new Float32Array(NE);
      this.edge = new Int8Array(this.count * NE);
      for (let i = 0; i < this.count; i++) {
        edges(this.rgb, i * N * 3, e);
        for (let k = 0; k < NE; k++) this.edge[i * NE + k] = Math.max(-127, Math.min(127, Math.round(e[k] * 32)));
      }
    }

    // Vérifie des cartes proposées par la lecture du numéro : pour chacune, son rang parmi toutes
    // les cartes de la base selon la ressemblance (70 % contours, 30 % couleurs), meilleur cadrage
    // retenu. Rang 1 = la plus ressemblante. Une carte absente de la base renvoie rank: null.
    // Mesuré sur de vraies vidéos : la bonne carte est dans les premiers rangs (1 à ~1 500 sur
    // 18 600), une carte issue d'un numéro mal lu est presque toujours au-delà de 5 000.
    verify(views, ids) {
      const qs = views.map((v) => {
        const all = new Uint8Array(N).fill(1);
        const rz = normalize(v, 0, all, new Float32Array(N * 3)), ez = edges(v, 0, new Float32Array(NE));
        return { r: Int8Array.from(rz, (x) => Math.max(-127, Math.min(127, Math.round(x * 32)))), e: Int8Array.from(ez, (x) => Math.max(-127, Math.min(127, Math.round(x * 32)))) };
      });
      const d = new Float32Array(this.count);
      for (let i = 0; i < this.count; i++) {
        let best = Infinity;
        const ro = i * N * 3, eo = i * NE;
        for (const q of qs) {
          let se = 0, sr = 0;
          for (let k = 0; k < NE; k++) { const x = q.e[k] - this.edge[eo + k]; se += x * x; }
          for (let k = 0; k < N * 3; k++) { const x = q.r[k] - this.pre[ro + k]; sr += x * x; }
          best = Math.min(best, 0.7 * Math.sqrt(se / NE) + 0.3 * Math.sqrt(sr / (N * 3)));
        }
        d[i] = best;
      }
      const index = new Map(this.ids.map((id, i) => [id, i]));
      return ids.map((id) => {
        const i = index.get(id);
        if (i === undefined) return { id, rank: null };
        let rank = 1; const x = d[i];
        for (let k = 0; k < this.count; k++) if (d[k] < x) rank++;
        return { id, rank };
      });
    }

    // Retourne les meilleures cartes : [{ i, id, name, d }] triées, d = distance (plus petit = plus proche).
    // `extra` : empreintes de la même scène avec un cadrage un peu différent (carte trop proche,
    // décalée…). Le premier tri se fait sur `q`, puis chaque carte retenue garde sa meilleure distance.
    search(q, top = 8, extra = []) {
      const mask = glareMask(q);
      let used = 0; for (let p = 0; p < N; p++) used += mask[p];
      if (used < N * 0.5) return []; // plus de la moitié de l'image brûlée : inutilisable
      const all = new Uint8Array(N).fill(1);
      const nqAll = normalize(q, 0, all, new Float32Array(N * 3));
      const qi = new Int8Array(N * 3);
      for (let k = 0; k < N * 3; k++) qi[k] = Math.max(-127, Math.min(127, Math.round(nqAll[k] * 32)));
      // 1. Tri rapide sur toutes les cartes
      const K = 80, bestI = new Int32Array(K).fill(-1), bestS = new Float64Array(K).fill(Infinity);
      for (let i = 0; i < this.count; i++) {
        const off = i * N * 3; let s = 0;
        for (let p = 0; p < N; p++) {
          if (!mask[p]) continue;
          const b = p * 3, d0 = qi[b] - this.pre[off + b], d1 = qi[b + 1] - this.pre[off + b + 1], d2 = qi[b + 2] - this.pre[off + b + 2];
          s += d0 * d0 + d1 * d1 + d2 * d2;
        }
        if (s < bestS[K - 1]) {
          let j = K - 1; while (j > 0 && bestS[j - 1] > s) { bestS[j] = bestS[j - 1]; bestI[j] = bestI[j - 1]; j--; }
          bestS[j] = s; bestI[j] = i;
        }
      }
      // 2. Calcul exact (normalisation sur les pixels non brûlés) pour les 80 meilleures,
      //    avec chaque cadrage proposé
      const views = [q, ...extra].map((v) => {
        const m = glareMask(v); let u = 0; for (let p = 0; p < N; p++) u += m[p];
        return u < N * 0.5 ? null : { m, u, n: normalize(v, 0, m, new Float32Array(N * 3)) };
      }).filter(Boolean);
      const nt = new Float32Array(N * 3), res = [];
      for (const i of bestI) {
        if (i < 0) continue;
        let bestD = Infinity;
        for (const v of views) {
          normalize(this.rgb, i * N * 3, v.m, nt);
          let s = 0;
          for (let p = 0; p < N; p++) if (v.m[p]) for (let ch = 0; ch < 3; ch++) { const d = v.n[p * 3 + ch] - nt[p * 3 + ch]; s += d * d; }
          bestD = Math.min(bestD, Math.sqrt(s / (v.u * 3)));
        }
        res.push({ i, id: this.ids[i], name: this.names[i], d: bestD });
      }
      return res.sort((a, b) => a.d - b.d).slice(0, top);
    }

    // Décision : carte sûre, rééditions à départager, ou rien.
    // Seuils réglés sur de vraies vidéos de téléphone (16 900 cartes) : aucune erreur acceptée.
    decide(q, extra = [], opts = {}) {
      const { maxD = 1.02, minGap = 0.12, strongGap = 0.22 } = opts;
      const r = this.search(q, 12, extra);
      if (!r.length) return { ok: false };
      const best = r[0];
      const other = r.find((x) => x.name !== best.name);
      const gap = other ? other.d - best.d : 1;
      if (best.d > maxD || gap < minGap) return { ok: false, best, gap };
      // Même illustration réimprimée dans plusieurs extensions : on garde toutes les cartes du même
      // nom proches de la meilleure ; l'appli départage avec le numéro ou en demandant.
      const same = r.filter((x) => x.name === best.name && x.d - best.d < 0.12);
      return { ok: true, best, gap, candidates: same, strong: gap >= strongGap };
    }
  }

  global.CardMatch = { W, H, N, BYTES, ALGO, describe, pack, Matcher, glareMask };
})(typeof window !== "undefined" ? window : globalThis);
