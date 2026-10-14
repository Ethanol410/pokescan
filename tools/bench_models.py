"""Banc d'essai des modèles de vision (lancé par .github/workflows/bench.yml).

Pour chaque modèle candidat : télécharge le modèle ONNX (zoo ONNX), le modifie pour sortir le
vecteur de caractéristiques (entrée du classifieur), en fait une version int8, puis calcule la
signature de toutes les cartes françaises. Résultats : bench/<modèle>.npy (float16, normalisés),
bench/ids.json, bench/models/<modèle>.onnx — publiés sur la branche « bench » pour évaluer les
modèles sur de vraies photos.
"""
import io, json, os, sys, time, concurrent.futures as cf
import numpy as np, requests, onnx
from onnx import helper
from PIL import Image
import onnxruntime as ort
from onnxruntime.quantization import quantize_dynamic, QuantType

ZOO = "https://media.githubusercontent.com/media/onnx/models/main/Computer_Vision/{0}_Opset17_timm/{0}_Opset17.onnx"
MODELS = os.environ.get("MODELS", "mobilenetv3_large_100,efficientnet_b0,resmlp_12_224_dino,lcnet_100").split(",")
OUT = "bench"; os.makedirs(OUT + "/models", exist_ok=True); os.makedirs("cache", exist_ok=True)
MEAN = np.array([0.485, 0.456, 0.406], np.float32); STD = np.array([0.229, 0.224, 0.225], np.float32)
S = requests.Session()

def feature_model(name):
    path = f"cache/{name}.onnx"
    if not os.path.exists(path):
        r = S.get(ZOO.format(name), timeout=300); r.raise_for_status(); open(path, "wb").write(r.content)
    m = onnx.load(path)
    g = m.graph
    # Le classifieur est le dernier Gemm/MatMul : son entrée est le vecteur de caractéristiques.
    last = [n for n in g.node if n.op_type in ("Gemm", "MatMul")][-1]
    feat = last.input[0]
    del g.output[:]
    g.output.append(helper.make_tensor_value_info(feat, onnx.TensorProto.FLOAT, None))
    # On retire tout ce qui ne sert plus à calculer cette sortie (le classifieur).
    needed, keep = {feat}, []
    for n in reversed(g.node):
        if any(o in needed for o in n.output):
            keep.append(n); needed.update(n.input)
    del g.node[:]; g.node.extend(reversed(keep))
    inits = [i for i in g.initializer if i.name in needed]
    del g.initializer[:]; g.initializer.extend(inits)
    fp = f"{OUT}/models/{name}.fp32.onnx"; onnx.save(m, fp)
    q = f"{OUT}/models/{name}.int8.onnx"
    quantize_dynamic(fp, q, weight_type=QuantType.QInt8)
    print(name, "fp32", os.path.getsize(fp) // 1024, "Ko  int8", os.path.getsize(q) // 1024, "Ko", flush=True)
    return q

def prep(im):
    im = im.convert("RGB").resize((224, 224), Image.BILINEAR)
    a = (np.asarray(im, np.float32) / 255 - MEAN) / STD
    return a.transpose(2, 0, 1)

def cards():
    pocket = lambda i: __import__("re").match(r"^[AB]\d|^P-[A-Z]$", i.split("-")[0])
    fr = S.get("https://api.tcgdex.net/v2/fr/cards", timeout=120).json()
    en = {c["id"]: c["image"] for c in S.get("https://api.tcgdex.net/v2/en/cards", timeout=120).json() if c.get("image")}
    out = []
    for c in fr:
        if pocket(c["id"]): continue
        img = c.get("image") or en.get(c["id"])
        if img: out.append({"id": c["id"], "name": c["name"], "image": img})
    return out

def fetch(c):
    p = f"cache/{c['id']}.webp"
    if os.path.exists(p): return p
    for k in range(4):
        try:
            r = S.get(c["image"] + "/low.webp", timeout=30)
            if r.status_code == 200: open(p, "wb").write(r.content); return p
            if r.status_code == 404: return None
        except Exception: pass
        time.sleep(2 * (k + 1))
    return None

def main():
    lst = cards()
    print(len(lst), "cartes", flush=True)
    with cf.ThreadPoolExecutor(16) as ex:
        paths = list(ex.map(fetch, lst))
    ok = [(c, p) for c, p in zip(lst, paths) if p]
    print(len(ok), "images", flush=True)
    json.dump([{"id": c["id"], "name": c["name"]} for c, _ in ok], open(f"{OUT}/ids.json", "w"), ensure_ascii=False)
    for name in MODELS:
        q = feature_model(name)
        so = ort.SessionOptions(); so.intra_op_num_threads = os.cpu_count()
        sess = ort.InferenceSession(q, so); inp = sess.get_inputs()[0].name
        embs = []; t = time.time()
        for i in range(0, len(ok), 64):
            batch = np.stack([prep(Image.open(p)) for _, p in ok[i:i + 64]])
            e = sess.run(None, {inp: batch})[0].reshape(len(batch), -1)
            embs.append(e / np.linalg.norm(e, axis=1, keepdims=True))
            if i % 3200 == 0: print(f"  {name} {i}/{len(ok)} {time.time() - t:.0f}s", flush=True)
        np.save(f"{OUT}/{name}.npy", np.concatenate(embs).astype(np.float16))
        print(name, "fini en", int(time.time() - t), "s", flush=True)

if __name__ == "__main__":
    main()
