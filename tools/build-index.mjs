// Construit l'index d'images des cartes françaises (index/cards.json + index/cards-<version>.bin).
// Tourne dans un vrai Chromium (Playwright) pour calculer les empreintes avec le même code
// que l'appli (match.js) : c'est indispensable pour que la comparaison sur le téléphone soit juste.
//
//   npm i --no-save playwright && npx playwright install chromium && node tools/build-index.mjs
import { chromium } from "playwright";
import fs from "node:fs/promises";
import crypto from "node:crypto";

const browser = await chromium.launch();
const page = await browser.newPage();
// Le serveur d'images renvoie parfois un en-tête CORS en double (« *, * ») que Chromium refuse :
// les images sont donc téléchargées par Node, puis transmises à la page avec un en-tête propre.
await page.route("https://assets.tcgdex.net/**", async (route) => {
  try {
    const r = await fetch(route.request().url(), { signal: AbortSignal.timeout(20000) });
    await route.fulfill({
      status: r.status,
      headers: { "content-type": r.headers.get("content-type") || "image/webp", "access-control-allow-origin": "*", ...(r.headers.get("retry-after") ? { "retry-after": r.headers.get("retry-after") } : {}) },
      body: Buffer.from(await r.arrayBuffer()),
    });
  } catch { await route.abort("failed"); }
});
// On se place sur le domaine de l'API pour que les requêtes vers TCGdex soient autorisées.
await page.goto("https://api.tcgdex.net/v2/fr/sets");
await page.addScriptTag({ path: new URL("../match.js", import.meta.url).pathname });
const ALGO = await page.evaluate(() => CardMatch.ALGO);

// Empreintes déjà calculées (index précédent) : on ne retélécharge que les nouvelles cartes.
const dir = new URL("../index/", import.meta.url).pathname;
let previous = {};
try {
  const meta = JSON.parse(await fs.readFile(dir + "cards.json", "utf8"));
  if (meta.algo !== ALGO) throw new Error(`calcul d'empreinte changé (${meta.algo ?? 1} → ${ALGO})`);
  const buf = await fs.readFile(dir + meta.file);
  meta.ids.forEach((id, k) => { previous[id] = buf.subarray(k * 288, (k + 1) * 288).toString("base64"); });
  console.log(`Index précédent : ${meta.ids.length} cartes réutilisables`);
} catch (e) { previous = {}; console.log("Construction complète : " + (e.message || "pas d'index précédent")); }

page.on("console", (m) => { if (m.type() === "log") console.log("  " + m.text()); });
const res = await page.evaluate(async (previous) => {
  const pocket = (id) => /^[AB]\d|^P-[A-Z]$/.test(id.split("-")[0]); // jeu mobile TCG Pocket
  const fr = await (await fetch("https://api.tcgdex.net/v2/fr/cards")).json();
  const en = await (await fetch("https://api.tcgdex.net/v2/en/cards")).json();
  const enImage = new Map(en.filter((c) => c.image).map((c) => [c.id, c.image]));
  // Carte sans image française : on prend l'image anglaise (même illustration).
  const list = fr.filter((c) => !pocket(c.id))
    .map((c) => ({ id: c.id, name: c.name, image: c.image || enImage.get(c.id) }))
    .filter((c) => c.image);
  const out = new Array(list.length);
  const errors = {};
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  let next = 0, done = 0, fails = 0, reused = 0;
  async function get(url) {
    const ctrl = new AbortController(), t = setTimeout(() => ctrl.abort(), 20000);
    try { return await fetch(url, { signal: ctrl.signal }); } finally { clearTimeout(t); }
  }
  async function worker() {
    while (next < list.length) {
      const k = next++, c = list[k];
      if (previous[c.id]) { out[k] = Uint8Array.from(atob(previous[c.id]), (ch) => ch.charCodeAt(0)); reused++; done++; continue; }
      for (let attempt = 0; attempt < 6; attempt++) {
        try {
          const r = await get(c.image + "/low.webp");
          if (!r.ok) {
            errors[r.status] = (errors[r.status] || 0) + 1;
            if (r.status === 404) break; // image absente : inutile de réessayer
            const wait = Number(r.headers.get("retry-after")) * 1000 || 1000 * 2 ** attempt;
            await sleep(wait); continue;
          }
          const bmp = await createImageBitmap(await r.blob());
          out[k] = CardMatch.pack(CardMatch.describe(bmp, { x: 0, y: 0, w: bmp.width, h: bmp.height }));
          bmp.close();
          break;
        } catch (e) {
          errors[e.name || "erreur"] = (errors[e.name || "erreur"] || 0) + 1;
          await sleep(1000 * 2 ** attempt);
        }
      }
      if (!out[k]) fails++;
      if (++done % 1000 === 0) console.log(`${done} / ${list.length} (${fails} échecs, ${reused} réutilisées)`);
    }
  }
  await Promise.all(Array.from({ length: 6 }, worker));
  console.log("Erreurs rencontrées : " + JSON.stringify(errors));
  const ids = [], names = [], parts = [];
  list.forEach((c, k) => { if (out[k]) { ids.push(c.id); names.push(c.name); parts.push(out[k]); } });
  const buf = new Uint8Array(parts.length * CardMatch.BYTES);
  parts.forEach((b, k) => buf.set(b, k * CardMatch.BYTES));
  let bin = "";
  for (let k = 0; k < buf.length; k += 0x8000) bin += String.fromCharCode.apply(null, buf.subarray(k, k + 0x8000));
  return { ids, names, fails, total: list.length, b64: btoa(bin) };
}, previous);
await browser.close();

console.log(`Empreintes : ${res.ids.length} / ${res.total} cartes (${res.fails} échecs)`);
if (res.ids.length < 10000) {
  console.error("Trop peu de cartes : l'index existant est conservé.");
  process.exit(1);
}
const buf = Buffer.from(res.b64, "base64");
const version = crypto.createHash("sha1").update(buf).update(res.ids.join(",")).digest("hex").slice(0, 10);
await fs.mkdir(dir, { recursive: true });
for (const f of await fs.readdir(dir)) if (/^cards-.*\.bin$/.test(f)) await fs.unlink(dir + f);
await fs.writeFile(dir + `cards-${version}.bin`, buf);
await fs.writeFile(dir + "cards.json", JSON.stringify({
  version, file: `cards-${version}.bin`, built: new Date().toISOString().slice(0, 10),
  w: 12, h: 16, bits: 4, algo: ALGO,
  count: res.ids.length, ids: res.ids, names: res.names,
}));
console.log(`index/cards-${version}.bin (${(buf.length / 1e6).toFixed(1)} Mo)`);
