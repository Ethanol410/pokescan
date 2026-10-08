/* Repère la carte dans l'image : cherche le rectangle au format carte (63×88) dont le
 * contour est le plus net. Sert quand la carte ne remplit pas le cadre (tenue plus loin,
 * décalée) : l'empreinte est alors calculée sur la carte seule, pas sur la main autour.
 *
 * window.CardLocate.locate(source, rect) -> { x, y, w, h, score } en pixels de la source, ou null.
 */
(function () {
  "use strict";
  const RATIO = 88 / 63;
  const SW = 128; // largeur de travail
  let cv, ctx;

  function locate(source, rect, opts = {}) {
    const sw = source.videoWidth || source.naturalWidth || source.width;
    const sh = source.videoHeight || source.naturalHeight || source.height;
    // zone de recherche : le cadre élargi de 12 %
    const mx = rect.w * 0.12, my = rect.h * 0.08;
    const zx = Math.max(0, rect.x - mx), zy = Math.max(0, rect.y - my);
    const zw = Math.min(sw, rect.x + rect.w + mx) - zx, zh = Math.min(sh, rect.y + rect.h + my) - zy;
    const W = SW, H = Math.round(SW * zh / zw), k = zw / W;
    if (!cv) { cv = document.createElement("canvas"); ctx = cv.getContext("2d", { willReadFrequently: true }); }
    cv.width = W; cv.height = H;
    ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = "high";
    ctx.drawImage(source, zx, zy, zw, zh, 0, 0, W, H);
    const px = ctx.getImageData(0, 0, W, H).data;
    // luminance + couleur (le bord d'une carte se voit aussi par la teinte)
    const L = new Float32Array(W * H), C = new Float32Array(W * H);
    for (let i = 0, j = 0; i < W * H; i++, j += 4) {
      const r = px[j], g = px[j + 1], b = px[j + 2];
      L[i] = 0.299 * r + 0.587 * g + 0.114 * b;
      C[i] = r - b;
    }
    // gradients horizontaux (bords verticaux) et verticaux (bords horizontaux)
    const GX = new Float32Array(W * H), GY = new Float32Array(W * H);
    for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
      const i = y * W + x;
      GX[i] = Math.abs(L[i + 1] - L[i - 1]) + 0.5 * Math.abs(C[i + 1] - C[i - 1]);
      GY[i] = Math.abs(L[i + W] - L[i - W]) + 0.5 * Math.abs(C[i + W] - C[i - W]);
    }
    // sommes cumulées : colonne (GX le long de y) et ligne (GY le long de x)
    const CX = new Float32Array(W * (H + 1)), CY = new Float32Array((W + 1) * H);
    for (let x = 0; x < W; x++) for (let y = 0; y < H; y++) CX[(y + 1) * W + x] = CX[y * W + x] + GX[y * W + x];
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) CY[y * (W + 1) + x + 1] = CY[y * (W + 1) + x] + GY[y * W + x];
    const colSum = (x, y0, y1) => CX[y1 * W + x] - CX[y0 * W + x];
    const rowSum = (y, x0, x1) => CY[y * (W + 1) + x1] - CY[y * (W + 1) + x0];
    // meilleur de 2 pixels voisins (tolère 1 px d'erreur / légère perspective)
    const vEdge = (x, y0, y1) => Math.max(colSum(x, y0, y1), x > 1 ? colSum(x - 1, y0, y1) : 0, x < W - 2 ? colSum(x + 1, y0, y1) : 0);
    const hEdge = (y, x0, x1) => Math.max(rowSum(y, x0, x1), y > 1 ? rowSum(y - 1, x0, x1) : 0, y < H - 2 ? rowSum(y + 1, x0, x1) : 0);

    const fw = rect.w / k; // largeur du cadre en pixels de travail
    const minW = Math.max(20, fw * (opts.minScale || 0.45)), maxW = Math.min(W - 2, fw * 1.15);
    let best = null;
    for (let w = minW; w <= maxW; w += 1.5) {
      for (const ar of [RATIO * 0.96, RATIO, RATIO * 1.04]) {
        const h = Math.round(w * ar), wi = Math.round(w);
        if (h >= H - 2) continue;
        for (let y = 1; y + h < H - 1; y += 1) {
          for (let x = 1; x + wi < W - 1; x += 1) {
            // côtés : on évite les coins arrondis (8 % de chaque bout)
            const iy0 = y + Math.round(h * 0.08), iy1 = y + h - Math.round(h * 0.08);
            const ix0 = x + Math.round(wi * 0.08), ix1 = x + wi - Math.round(wi * 0.08);
            const l = vEdge(x, iy0, iy1) / (iy1 - iy0), r = vEdge(x + wi, iy0, iy1) / (iy1 - iy0);
            const t = hEdge(y, ix0, ix1) / (ix1 - ix0), b = hEdge(y + h, ix0, ix1) / (ix1 - ix0);
            // les 4 côtés doivent être présents : on pénalise le plus faible
            const s = (l + r + t + b) / 4 + Math.min(l, r, t, b);
            if (!best || s > best.s) best = { s, x, y, w: wi, h };
          }
        }
      }
    }
    if (!best) return null;
    return { x: zx + best.x * k, y: zy + best.y * k, w: best.w * k, h: best.h * k, score: best.s };
  }

  window.CardLocate = { locate };
})();
