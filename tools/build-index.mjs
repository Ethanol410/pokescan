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
// On se place sur le domaine de l'API pour que les requêtes vers TCGdex soient autorisées.
await page.goto("https://api.tcgdex.net/v2/fr/sets");
await page.addScriptTag({ path: new URL("../match.js", import.meta.url).pathname });

const res = await page.evaluate(async () => {
  const pocket = (id) => /^[AB]\d|^P-[A-Z]$/.test(id.split("-")[0]); // jeu mobile TCG Pocket
  const fr = await (await fetch("https://api.tcgdex.net/v2/fr/cards")).json();
  const en = await (await fetch("https://api.tcgdex.net/v2/en/cards")).json();
  const enImage = new Map(en.filter((c) => c.image).map((c) => [c.id, c.image]));
  // Carte sans image française : on prend l'image anglaise (même illustration).
  const list = fr.filter((c) => !pocket(c.id))
    .map((c) => ({ id: c.id, name: c.name, image: c.image || enImage.get(c.id) }))
    .filter((c) => c.image);
  const out = new Array(list.length);
  let next = 0, fails = 0;
  async function worker() {
    while (next < list.length) {
      const k = next++, c = list[k];
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const r = await fetch(c.image + "/low.webp");
          if (!r.ok) throw new Error(r.status);
          const bmp = await createImageBitmap(await r.blob());
          out[k] = CardMatch.pack(CardMatch.describe(bmp, { x: 0, y: 0, w: bmp.width, h: bmp.height }));
          bmp.close();
          break;
        } catch { if (attempt === 2) fails++; else await new Promise((r) => setTimeout(r, 500)); }
      }
    }
  }
  await Promise.all(Array.from({ length: 16 }, worker));
  const ids = [], names = [], parts = [];
  list.forEach((c, k) => { if (out[k]) { ids.push(c.id); names.push(c.name); parts.push(out[k]); } });
  const buf = new Uint8Array(parts.length * CardMatch.BYTES);
  parts.forEach((b, k) => buf.set(b, k * CardMatch.BYTES));
  let bin = "";
  for (let k = 0; k < buf.length; k += 0x8000) bin += String.fromCharCode.apply(null, buf.subarray(k, k + 0x8000));
  return { ids, names, fails, total: list.length, b64: btoa(bin) };
});
await browser.close();

console.log(`Empreintes : ${res.ids.length} / ${res.total} cartes (${res.fails} échecs)`);
if (res.ids.length < 10000) {
  console.error("Trop peu de cartes : l'index existant est conservé.");
  process.exit(1);
}
const buf = Buffer.from(res.b64, "base64");
const version = crypto.createHash("sha1").update(buf).update(res.ids.join(",")).digest("hex").slice(0, 10);
const dir = new URL("../index/", import.meta.url).pathname;
await fs.mkdir(dir, { recursive: true });
for (const f of await fs.readdir(dir)) if (/^cards-.*\.bin$/.test(f)) await fs.unlink(dir + f);
await fs.writeFile(dir + `cards-${version}.bin`, buf);
await fs.writeFile(dir + "cards.json", JSON.stringify({
  version, file: `cards-${version}.bin`, built: new Date().toISOString().slice(0, 10),
  w: 12, h: 16, bits: 4, count: res.ids.length, ids: res.ids, names: res.names,
}));
console.log(`index/cards-${version}.bin (${(buf.length / 1e6).toFixed(1)} Mo)`);
