"""Banc d'essai, 2e étape : photos simulées de cartes (perspective, reflets, pochette, flou,
lumière, fond) et leurs signatures, pour apprendre une projection qui rend la signature
insensible à ces défauts. Résultats : bench/aug_<modèle>.npz (clean, aug, index des cartes).
"""
import json, os, random, time
import numpy as np, onnxruntime as ort
from PIL import Image, ImageDraw, ImageFilter, ImageEnhance

MODEL = os.environ.get("MODEL", "lcnet_100"); N = int(os.environ.get("NCARDS", "5000")); K = int(os.environ.get("NAUG", "3"))
OUT = "bench"; rng = random.Random(1)
MEAN = np.array([0.485, 0.456, 0.406], np.float32); STD = np.array([0.229, 0.224, 0.225], np.float32)
def prep(im):
    a = (np.asarray(im.convert("RGB").resize((224, 224), Image.BILINEAR), np.float32) / 255 - MEAN) / STD
    return a.transpose(2, 0, 1)[None]

def find_coeffs(src, dst):  # perspective PIL : 8 coefficients
    A = []
    for (x, y), (u, v) in zip(dst, src):
        A += [[x, y, 1, 0, 0, 0, -u * x, -u * y], [0, 0, 0, x, y, 1, -v * x, -v * y]]
    return np.linalg.solve(np.array(A, float), np.array(src, float).reshape(8)).tolist()

def background(W, H):
    kind = rng.random()
    if kind < 0.4:  # peau / main
        c = (rng.randint(150, 230), rng.randint(100, 170), rng.randint(80, 140))
    elif kind < 0.7:  # table sombre
        g = rng.randint(10, 80); c = (g + rng.randint(0, 30), g + rng.randint(0, 20), g)
    else:
        c = tuple(rng.randint(0, 255) for _ in range(3))
    bg = Image.new("RGB", (W, H), c)
    noise = (np.random.RandomState(rng.randint(0, 1 << 30)).randn(H // 8, W // 8, 3) * rng.uniform(5, 30)).astype(np.float32)
    n = Image.fromarray(np.clip(np.asarray(bg, np.float32)[::8, ::8] + noise, 0, 255).astype(np.uint8)).resize((W, H), Image.BICUBIC)
    return n.filter(ImageFilter.GaussianBlur(rng.uniform(2, 8)))

def glare(im):
    W, H = im.size; ov = Image.new("L", (W, H), 0); d = ImageDraw.Draw(ov)
    for _ in range(rng.randint(1, 3)):
        cx, cy = rng.uniform(0, W), rng.uniform(0, H); rx, ry = rng.uniform(W * .05, W * .4), rng.uniform(H * .03, H * .25)
        d.ellipse([cx - rx, cy - ry, cx + rx, cy + ry], fill=rng.randint(120, 255))
    ov = ov.filter(ImageFilter.GaussianBlur(rng.uniform(8, 30)))
    white = Image.new("RGB", (W, H), (255, 255, 250))
    return Image.composite(white, im, ov)

def holo(im):  # bandes arc-en-ciel des cartes brillantes
    W, H = im.size
    x = np.linspace(0, 1, W)[None, :] + np.linspace(0, rng.uniform(-1, 1), H)[:, None]
    f = rng.uniform(3, 12); ph = rng.uniform(0, 6.28)
    rgb = np.stack([np.sin(2 * np.pi * f * x + ph + k * 2.1) for k in range(3)], -1) * 0.5 + 0.5
    a = rng.uniform(0.05, 0.25)
    return Image.fromarray(np.clip(np.asarray(im, np.float32) * (1 - a) + rgb * 255 * a, 0, 255).astype(np.uint8))

def simulate(card):
    card = card.convert("RGB").resize((315, 440), Image.BICUBIC)
    if rng.random() < 0.5: card = holo(card)
    if rng.random() < 0.7: card = glare(card)
    if rng.random() < 0.5:  # pochette / toploader : voile + liseré
        haze = rng.uniform(0.05, 0.25)
        card = Image.blend(card, Image.new("RGB", card.size, (235, 235, 240)), haze)
    W, H = 480, 640; bg = background(W, H)
    s = rng.uniform(0.6, 0.98); cw, ch = W * s, W * s * 88 / 63
    if ch > H * 0.98: ch = H * 0.98; cw = ch * 63 / 88
    x0 = (W - cw) / 2 + rng.uniform(-0.08, 0.08) * W; y0 = (H - ch) / 2 + rng.uniform(-0.08, 0.08) * H
    j = lambda: rng.uniform(-0.04, 0.04) * cw
    dst = [(x0 + j(), y0 + j()), (x0 + cw + j(), y0 + j()), (x0 + cw + j(), y0 + ch + j()), (x0 + j(), y0 + ch + j())]
    src = [(0, 0), (315, 0), (315, 440), (0, 440)]
    warped = card.transform((W, H), Image.PERSPECTIVE, find_coeffs(src, dst), Image.BICUBIC)
    mask = Image.new("L", (315, 440), 255).transform((W, H), Image.PERSPECTIVE, find_coeffs(src, dst), Image.BICUBIC)
    im = Image.composite(warped, bg, mask)
    im = ImageEnhance.Brightness(im).enhance(rng.uniform(0.55, 1.3))
    im = ImageEnhance.Contrast(im).enhance(rng.uniform(0.7, 1.2))
    im = ImageEnhance.Color(im).enhance(rng.uniform(0.7, 1.3))
    tint = np.array([rng.uniform(0.85, 1.1), 1, rng.uniform(0.8, 1.1)], np.float32)
    im = Image.fromarray(np.clip(np.asarray(im, np.float32) * tint, 0, 255).astype(np.uint8))
    if rng.random() < 0.6: im = im.filter(ImageFilter.GaussianBlur(rng.uniform(0.3, 2.0)))
    # cadrage façon appli : le cadre du viseur, plus ou moins bien rempli par la carte
    fw = W * rng.uniform(0.85, 1.0); fh = fw * 88 / 63
    if fh > H: fh = H; fw = fh * 63 / 88
    fx = (W - fw) / 2; fy = (H - fh) / 2
    return im.crop((int(fx), int(fy), int(fx + fw), int(fy + fh)))

def main():
    ids = json.load(open(f"{OUT}/ids.json")); sel = sorted(rng.sample(range(len(ids)), min(N, len(ids))))
    sess = ort.InferenceSession(f"{OUT}/models/{MODEL}.fp16w.onnx"); inp = sess.get_inputs()[0].name
    emb = lambda im: (lambda e: e / np.linalg.norm(e))(sess.run(None, {inp: prep(im)})[0].reshape(-1))
    clean, aug, who = [], [], []; t = time.time()
    os.makedirs(f"{OUT}/samples", exist_ok=True)
    for n, k in enumerate(sel):
        try: card = Image.open(f"cache/{ids[k]['id']}.webp")
        except Exception: continue
        clean.append(emb(card))
        for a in range(K):
            im = simulate(card)
            if n < 12 and a == 0: im.save(f"{OUT}/samples/{n}.jpg", quality=80)
            aug.append(emb(im)); who.append(len(clean) - 1)
        if n % 500 == 0: print(f"  {n}/{len(sel)} {time.time() - t:.0f}s", flush=True)
    np.savez_compressed(f"{OUT}/aug_{MODEL}.npz", clean=np.array(clean, np.float16), aug=np.array(aug, np.float16), who=np.array(who), sel=np.array(sel))

if __name__ == "__main__":
    main()
