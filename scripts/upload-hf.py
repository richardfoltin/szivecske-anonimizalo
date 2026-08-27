"""
A saját ONNX-exportunk közzététele a Hugging Face-en — CSAK KIADÁSKOR fut.

Miért kell egyáltalán: az eredeti NYTK-tároló `pytorch_model.bin`-t közöl,
futtatható ONNX-et nem, és senki más nem tett közzé belőle exportot. A
felhasználó gépén viszont nincs se Python, se PyTorch — a programnak kész ONNX
kell. Az átalakítást build-időben végezzük el (`scripts/export-nytk.py`), az
eredményt pedig itt tesszük közzé, hogy a program token nélkül letölthesse.

Amit NEM csinálunk: nem tanítunk, nem hangolunk, nem nyúlunk a súlyokhoz. A
modell a NYTK-é, Apache-2.0 alatt; a licenc a továbbadást feltüntetéssel
engedi, és a modellkártya meg is nevezi az eredeti alkotókat.

A tokent NEM ez a fájl tárolja: a `huggingface_hub` a szokásos helyekről veszi
(`HF_TOKEN` környezeti változó vagy `huggingface-cli login`).
"""

import os
import sys
from pathlib import Path

from huggingface_hub import HfApi

ROOT = Path(__file__).resolve().parent.parent
FORRAS = ROOT / ".modellek" / "NYTK" / "named-entity-recognition-nerkor-hubert-hungarian"

# A 8 bites változat SZÁNDÉKOSAN kimarad: a mérésünk szerint elveszít egy csupa
# nagybetűs aláírásban álló személynevet (`npm run test:quant`). Ha itt lenne,
# valaki letöltené és nem tudná, mit veszít vele.
FAJLOK = [
    "model.onnx",
    "config.json",
    "tokenizer.json",
    "tokenizer_config.json",
    "SHA256SUMS.json",
]


def main() -> int:
    token = os.environ.get("HF_TOKEN")
    if not token:
        print("Nincs HF_TOKEN. Futtasd: huggingface-cli login", file=sys.stderr)
        return 1

    api = HfApi(token=token)
    ki = api.whoami()
    repo_id = f"{ki['name']}/nerkor-hubert-hungarian-onnx"

    hiany = [f for f in FAJLOK if not (FORRAS / f).exists()]
    if hiany:
        print(f"Hiányzó fájl: {', '.join(hiany)}", file=sys.stderr)
        return 1

    kartya = Path(sys.argv[1]) if len(sys.argv) > 1 else None
    if kartya is None or not kartya.exists():
        print("Add meg a modellkártya útvonalát első paraméterként.", file=sys.stderr)
        return 1

    print(f"fiók:  {ki['name']}")
    print(f"tároló: {repo_id}  (nyilvános)")
    meret = sum((FORRAS / f).stat().st_size for f in FAJLOK)
    print(f"méret: {meret:,} bájt\n")

    api.create_repo(repo_id=repo_id, repo_type="model", private=False, exist_ok=True)
    print("tároló kész")

    api.upload_file(
        path_or_fileobj=str(kartya),
        path_in_repo="README.md",
        repo_id=repo_id,
        repo_type="model",
    )
    print("  README.md")

    for f in FAJLOK:
        p = FORRAS / f
        api.upload_file(
            path_or_fileobj=str(p),
            path_in_repo=f,
            repo_id=repo_id,
            repo_type="model",
        )
        print(f"  {f}  ({p.stat().st_size:,} bájt)")

    print(f"\nKész: https://huggingface.co/{repo_id}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
