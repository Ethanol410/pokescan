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

  let mid, midCtx, small, smallCtx;
  function canvases() {
    if (!mid) {
      const make = (w, h) => (typeof OffscreenCanvas !== "undefined" ? new OffscreenCanvas(w, h) : Object.assign(document.createElement("canvas"), { width: w, height: h }));
      mid = make(96, 128); midCtx = mid.getContext("2d");
      small = make(W, H); smallCtx = small.getContext("2d", { willReadFrequently: true });
    }
  }

  // Empreinte RGB 12×16 (Uint8Array de 576 valeurs) d'une zone d'une image, vidéo ou canvas.
  // La réduction se fait en deux étapes (96×128 puis 12×16) pour bien moyenner les pixels.
  function describe(source, rect) {
    canvases();
    const r = rect || { x: 0, y: 0, w: source.videoWidth || source.width, h: source.videoHeight || source.height };
    midCtx.drawImage(source, r.x, r.y, r.w, r.h, 0, 0, 96, 128);
    smallCtx.drawImage(mid, 0, 0, W, H);
    const d = smallCtx.getImageData(0, 0, W, H).data;
    const o = new Uint8Array(N * 3);
    for (let i = 0, j = 0; i < d.length; i += 4) { o[j++] = d[i]; o[j++] = d[i + 1]; o[j++] = d[i + 2]; }
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
    decide(q, extra = []) {
      const r = this.search(q, 12, extra);
      if (!r.length) return { ok: false };
      const best = r[0];
      const other = r.find((x) => x.name !== best.name);
      const gap = other ? other.d - best.d : 1;
      if (best.d > 1.02 || gap < 0.12) return { ok: false, best, gap };
      // Même illustration réimprimée dans plusieurs extensions : on garde toutes les cartes du même
      // nom proches de la meilleure ; l'appli départage avec le numéro ou en demandant.
      const same = r.filter((x) => x.name === best.name && x.d - best.d < 0.12);
      return { ok: true, best, gap, candidates: same, strong: gap >= 0.22 };
    }
  }

  global.CardMatch = { W, H, N, BYTES, describe, pack, Matcher, glareMask };
})(typeof window !== "undefined" ? window : globalThis);
