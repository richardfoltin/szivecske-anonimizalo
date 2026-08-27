"""
Az NYTK magyar NER-modell ONNX-be exportálása.

Ez BUILD-IDEJŰ lépés: Python csak itt fut, a kész programba semmi nem kerül
belőle. A tárolóban nincs ONNX, ezért nekünk kell előállítani — és ezzel együtt
vállaljuk, hogy minden torch/onnxruntime frissítés után újra ellenőrizzük.

    py -3.12 scripts/export-nytk.py
"""
import hashlib
import json
import os
import sys
import time

REPO = "NYTK/named-entity-recognition-nerkor-hubert-hungarian"
OUT = os.path.join(os.path.dirname(__file__), "..", ".modellek", "NYTK",
                   "named-entity-recognition-nerkor-hubert-hungarian")

def main() -> None:
    import torch
    from transformers import AutoConfig, AutoModelForTokenClassification, AutoTokenizer

    os.makedirs(OUT, exist_ok=True)
    print(f"Letöltés: {REPO}")
    tok = AutoTokenizer.from_pretrained(REPO)

    # A tárolóban csak `pytorch_model.bin` van, safetensors nincs. Az újabb
    # transformers a `torch.load`-ot torch>=2.6 alatt megtagadja (CVE-2025-32434),
    # ezért a súlyokat magunk töltjük be `weights_only=True` mellett, és a
    # betöltést ELLENŐRIZZÜK — egy csendes kulcseltérés használhatatlan modellt
    # adna, amit csak a kimeneten vennénk észre.
    from huggingface_hub import hf_hub_download

    cfg0 = AutoConfig.from_pretrained(REPO)
    model = AutoModelForTokenClassification.from_config(cfg0)
    weights = hf_hub_download(REPO, "pytorch_model.bin")
    state = torch.load(weights, map_location="cpu", weights_only=True)
    missing, unexpected = model.load_state_dict(state, strict=False)
    real_missing = [k for k in missing if "position_ids" not in k]
    print(f"betöltés: {len(state)} tenzor, hiányzó={len(real_missing)}, ismeretlen={len(unexpected)}")
    if real_missing:
        raise SystemExit(f"HIÁNYZÓ SÚLYOK: {real_missing[:8]} — az export nem lenne érvényes")
    model.eval()

    cfg = AutoConfig.from_pretrained(REPO)
    print("címkék:", cfg.id2label)

    # A kísérőfájlokat is kiírjuk: a szótár és a címketábla a futtatáshoz kell.
    tok.save_pretrained(OUT)
    cfg.save_pretrained(OUT)

    dummy = tok("Kovács János felperes.", return_tensors="pt")
    args = (dummy["input_ids"], dummy["attention_mask"], dummy["token_type_ids"])

    onnx_path = os.path.join(OUT, "model.onnx")
    t0 = time.time()
    torch.onnx.export(
        model,
        args,
        onnx_path,
        input_names=["input_ids", "attention_mask", "token_type_ids"],
        output_names=["logits"],
        dynamic_axes={
            "input_ids": {0: "batch", 1: "seq"},
            "attention_mask": {0: "batch", 1: "seq"},
            "token_type_ids": {0: "batch", 1: "seq"},
            "logits": {0: "batch", 1: "seq"},
        },
        opset_version=17,
        do_constant_folding=True,
    )
    size = os.path.getsize(onnx_path)
    print(f"ONNX kész: {size:,} bájt, {time.time() - t0:.1f} s")

    # Ellenőrző összeg és származási adatok — ezek nélkül nem tudnánk később
    # megmondani, pontosan mit is szállítunk.
    sums = {}
    for name in sorted(os.listdir(OUT)):
        p = os.path.join(OUT, name)
        if not os.path.isfile(p) or name in ("SHA256SUMS.json", "PROVENANCE.md"):
            continue
        h = hashlib.sha256()
        with open(p, "rb") as f:
            for chunk in iter(lambda: f.read(1 << 20), b""):
                h.update(chunk)
        sums[name] = {"sha256": h.hexdigest(), "bytes": os.path.getsize(p)}
    with open(os.path.join(OUT, "SHA256SUMS.json"), "w", encoding="utf-8") as f:
        json.dump(sums, f, indent=1)

    with open(os.path.join(OUT, "PROVENANCE.md"), "w", encoding="utf-8") as f:
        f.write(
            f"# Származás\n\n"
            f"- Forrás: https://huggingface.co/{REPO}\n"
            f"- Licenc: Apache-2.0\n"
            f"- Exportálva: {time.strftime('%Y-%m-%d %H:%M')}\n"
            f"- torch {torch.__version__}, opset 17, do_constant_folding\n"
            f"- Kimenet: model.onnx ({size:,} bájt)\n\n"
            f"A tárolóban nincs ONNX; ezt a fájlt mi állítottuk elő. Minden\n"
            f"torch- vagy onnxruntime-frissítés után újra kell futtatni az\n"
            f"arany-dokumentumos ellenőrzést.\n"
        )
    print(f"Kész: {OUT}")

if __name__ == "__main__":
    sys.exit(main())
