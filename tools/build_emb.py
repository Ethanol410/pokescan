"""Construit la reconnaissance par modèle de vision (lancé par .github/workflows/emb.yml).

1. Modèle : LCNet (zoo ONNX, 3 Mo) dont on garde le vecteur de caractéristiques (1280 valeurs).
2. Projection apprise (« learned whitening ») : on fabrique des photos simulées de cartes
   (perspective, reflets, bandes holo, pochette, flou, lumière, fond) et on apprend une projection
   linéaire (512 valeurs) qui rapproche la photo de l'image d'origine. Elle est intégrée au modèle.
   Mesuré sur de vraies vidéos d'iPhone : bonne carte 1re dans 66 % des images (41 % sans projection).
3. Signatures de toutes les cartes de la langue (int8) : index/<lang>/emb-<version>.bin + emb.json.

Le modèle et sa projection ne changent que si REBUILD=1 (ou s'il n'existe pas encore) : chaque
semaine, seules les nouvelles cartes sont ajoutées à l'index.

Variables : LANG=fr|en|ja, REBUILD=1, NCARDS (photos simulées : nombre de cartes), NAUG (par carte).
"""
import hashlib, json, os, re, sys, time, concurrent.futures as cf
import numpy as np, requests, onnx
from onnx import helper, numpy_helper
from PIL import Image
import onnxruntime as ort

sys.path.insert(0, os.path.dirname(__file__))
from bench_aug import simulate  # même simulation que le banc d'essai

LANG = os.environ.get("LANG_CARDS", "fr")
REBUILD = os.environ.get("REBUILD") == "1"
NCARDS = int(os.environ.get("NCARDS", "8000")); NAUG = int(os.environ.get("NAUG", "3"))
DIM, LAM = 512, 0.3
ZOO = "https://media.githubusercontent.com/media/onnx/models/main/Computer_Vision/lcnet_100_Opset17_timm/lcnet_100_Opset17.onnx"
MODELS = "models"; IDX = f"index/{LANG}"
os.makedirs(MODELS, exist_ok=True); os.makedirs(IDX, exist_ok=True); os.makedirs("cache", exist_ok=True)
MEAN = np.array([0.485, 0.456, 0.406], np.float32); STD = np.array([0.229, 0.224, 0.225], np.float32)
S = requests.Session(); S.headers["User-Agent"] = "Mozilla/5.0 (PokeScan index; +https://github.com/Ethanol410/pokescan)"
log = lambda *a: print(*a, flush=True)

def prep(im):
    a = (np.asarray(im.convert("RGB").resize((224, 224), Image.BILINEAR), np.float32) / 255 - MEAN) / STD
    return a.transpose(2, 0, 1)[None]
norm = lambda x: x / np.linalg.norm(x, axis=-1, keepdims=True)

def cards():
    pocket = lambda i: re.match(r"^[AB]\d|^P-[A-Z]$", i.split("-")[0])
    get = lambda u: S.get(u, timeout=120).json()
    lst = get(f"https://api.tcgdex.net/v2/{LANG}/cards")
    # Carte sans image dans la langue : image anglaise (même illustration), sauf en japonais.
    en = {} if LANG in ("en", "ja") else {c["id"]: c["image"] for c in get("https://api.tcgdex.net/v2/en/cards") if c.get("image")}
    out = []
    for c in lst:
        if pocket(c["id"]): continue
        img = c.get("image") or en.get(c["id"])
        if img: out.append({"id": c["id"], "name": c["name"], "image": img})
    return out

def fetch(c):
    p = f"cache/{LANG}-{c['id']}.webp"
    if os.path.exists(p): return p
    for k in range(4):
        try:
            r = S.get(c["image"] + "/low.webp", timeout=30)
            if r.status_code == 200: open(p, "wb").write(r.content); return p
            if r.status_code == 404: return None
        except Exception: pass
        time.sleep(2 * (k + 1))
    return None

def feature_graph():
    path = "cache/lcnet.onnx"
    if not os.path.exists(path):
        r = S.get(ZOO, timeout=300); r.raise_for_status(); open(path, "wb").write(r.content)
    m = onnx.load(path); g = m.graph
    last = [n for n in g.node if n.op_type in ("Gemm", "MatMul")][-1]
    feat = last.input[0]
    del g.output[:]; g.output.append(helper.make_tensor_value_info(feat, onnx.TensorProto.FLOAT, None))
    needed, keep = {feat}, []
    for n in reversed(g.node):
        if any(o in needed for o in n.output): keep.append(n); needed.update(n.input)
    del g.node[:]; g.node.extend(reversed(keep))
    inits = [i for i in g.initializer if i.name in needed]; del g.initializer[:]; g.initializer.extend(inits)
    return m, feat

def bake(m, feat, mu, P):
    """Ajoute (x − moyenne) · P au modèle, sortie « emb » ; poids stockés en float16."""
    g = m.graph
    g.initializer.extend([numpy_helper.from_array(mu.astype(np.float32).reshape(1, -1), "lw_mu"), numpy_helper.from_array(P.astype(np.float32), "lw_P")])
    g.node.extend([helper.make_node("Flatten", [feat], ["lw_flat"], axis=1), helper.make_node("Sub", ["lw_flat", "lw_mu"], ["lw_c"]),
                   helper.make_node("MatMul", ["lw_c", "lw_P"], ["emb"])])
    del g.output[:]; g.output.append(helper.make_tensor_value_info("emb", onnx.TensorProto.FLOAT, [1, P.shape[1]]))
    casts, new = [], []
    for init in g.initializer:
        a = numpy_helper.to_array(init)
        if a.dtype == np.float32 and a.size >= 1024:
            new.append(numpy_helper.from_array(a.astype(np.float16), init.name + "_h"))
            casts.append(helper.make_node("Cast", [init.name + "_h"], [init.name], to=onnx.TensorProto.FLOAT))
        else: new.append(init)
    del g.initializer[:]; g.initializer.extend(new)
    nodes = list(g.node); del g.node[:]; g.node.extend(casts + nodes)
    onnx.checker.check_model(m)
    return m

def session(m_or_path):
    so = ort.SessionOptions(); so.intra_op_num_threads = os.cpu_count()
    return ort.InferenceSession(m_or_path if isinstance(m_or_path, str) else m_or_path.SerializeToString(), so)

def run(sess, im):
    return sess.run(None, {sess.get_inputs()[0].name: prep(im)})[0].reshape(-1)

def learn_projection(ok):
    m, feat = feature_graph(); sess = session(m)
    rng = np.random.RandomState(1); t = time.time()
    G = np.stack([norm(run(sess, Image.open(p))) for _, p in ok]); log("caractéristiques", G.shape, int(time.time() - t), "s")
    sel = rng.choice(len(ok), min(NCARDS, len(ok)), replace=False)
    D = []
    for n, k in enumerate(sel):
        card = Image.open(ok[k][1])
        for _ in range(NAUG): D.append(norm(run(sess, simulate(card))) - G[k])
        if n % 1000 == 0: log(f"  photos simulées {n}/{len(sel)} {time.time() - t:.0f}s")
    D = np.array(D, np.float64)
    mu = G.mean(0)
    Cs = D.T @ D / len(D); Cs += LAM * np.trace(Cs) / len(Cs) * np.eye(len(Cs))
    w, V = np.linalg.eigh(Cs); P1 = V @ np.diag(w ** -0.5) @ V.T
    X = (G - mu) @ P1; sub = X[rng.choice(len(X), min(8000, len(X)), replace=False)]
    _, _, Vt = np.linalg.svd(sub - sub.mean(0), full_matrices=False)
    P = P1 @ Vt[:DIM].T
    model = bake(m, feat, mu, P)
    data = model.SerializeToString(); h = hashlib.sha1(data).hexdigest()[:10]
    path = f"{MODELS}/card-{h}.onnx"; open(path, "wb").write(data)
    for old in os.listdir(MODELS):
        if old.startswith("card-") and old != os.path.basename(path): os.remove(f"{MODELS}/{old}")
    json.dump({"file": os.path.basename(path), "dim": DIM, "input": 224, "mean": MEAN.tolist(), "std": STD.tolist(), "built": time.strftime("%Y-%m-%d")},
              open(f"{MODELS}/card.json", "w"), indent=1)
    log("modèle", path, os.path.getsize(path) // 1024, "Ko")
    return path

def main():
    lst = cards(); log(len(lst), "cartes", LANG)
    with cf.ThreadPoolExecutor(16) as ex: paths = list(ex.map(fetch, lst))
    ok = [(c, p) for c, p in zip(lst, paths) if p]; log(len(ok), "images")
    if len(ok) < (2500 if LANG == "ja" else 10000): sys.exit("trop peu d'images, index non modifié")
    try: meta_m = json.load(open(f"{MODELS}/card.json")); mpath = f"{MODELS}/{meta_m['file']}"; assert os.path.exists(mpath)
    except Exception: meta_m = None
    if REBUILD or not meta_m:
        if LANG != "fr" and not REBUILD: sys.exit("le modèle se construit avec les cartes françaises (LANG_CARDS=fr)")
        mpath = learn_projection(ok)
    model = os.path.basename(mpath)
    # Index : on réutilise les signatures déjà calculées avec ce même modèle.
    prev = {}
    try:
        meta = json.load(open(f"{IDX}/emb.json"))
        if meta["model"] == model:
            buf = np.fromfile(f"{IDX}/{meta['file']}", np.int8).reshape(len(meta["ids"]), meta["dim"])
            prev = {i: buf[k] for k, i in enumerate(meta["ids"])}; scale = meta["scale"]
    except Exception: pass
    sess = session(mpath); vecs = []; t = time.time(); new = 0
    SCALE = 127 / 0.4  # composantes d'un vecteur normalisé de 512 valeurs : |x| < 0,33 dans 99,99 % des cas
    for n, (c, p) in enumerate(ok):
        if c["id"] in prev: vecs.append(prev[c["id"]]); continue
        e = norm(run(sess, Image.open(p))); vecs.append(np.clip(np.round(e * SCALE), -127, 127).astype(np.int8)); new += 1
        if new % 3000 == 0: log(f"  signatures {n}/{len(ok)} {time.time() - t:.0f}s")
    log(new, "nouvelles signatures")
    buf = np.stack(vecs).astype(np.int8).tobytes(); h = hashlib.sha1(buf).hexdigest()[:10]
    for old in os.listdir(IDX):
        if old.startswith("emb-"): os.remove(f"{IDX}/{old}")
    open(f"{IDX}/emb-{h}.bin", "wb").write(buf)
    json.dump({"version": h, "file": f"emb-{h}.bin", "model": model, "dim": DIM, "scale": SCALE, "lang": LANG, "built": time.strftime("%Y-%m-%d"),
               "count": len(ok), "ids": [c["id"] for c, _ in ok], "names": [c["name"] for c, _ in ok]}, open(f"{IDX}/emb.json", "w"), ensure_ascii=False)
    log("index", f"{IDX}/emb-{h}.bin", len(buf) // 1024, "Ko")

if __name__ == "__main__":
    main()
