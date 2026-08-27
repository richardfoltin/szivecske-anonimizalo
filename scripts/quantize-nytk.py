"""
A magyar NER-modell 8 bites tömörítése — CSAK ÉPÍTÉSKOR fut.

Ez a fájl, akárcsak az `export-nytk.py`, fejlesztői eszköz: a kész programba
semmi nem kerül belőle, és a felhasználó gépén nincs se Python, se PyTorch.

Miért kell: a lebegőpontos ONNX 440 MB. Egy asztali programnál ez se letöltésnek,
se telepítőbe csomagolva nem kellemes. A súlyok 8 bites egészre tömörítve
nagyjából negyedére esnek, a számítás pedig gyorsul is.

Amit NEM teszünk meg: nem hisszük el vakon, hogy a tömörítés ingyen van. A
tömörített modellt ugyanazon a szövegen le kell mérni, és a találatoknak
egyezniük kell — a mérést a `test/quant-compare.ts` végzi.
"""

import json
import sys
import time
from pathlib import Path

from onnxruntime.quantization import QuantType, quantize_dynamic
from onnxruntime.quantization.shape_inference import quant_pre_process

ROOT = Path(__file__).resolve().parent.parent
MODEL_DIR = ROOT / ".modellek" / "NYTK" / "named-entity-recognition-nerkor-hubert-hungarian"
SRC = MODEL_DIR / "model.onnx"
PREP = MODEL_DIR / "model.prep.onnx"
DST = MODEL_DIR / "model.int8.onnx"


def mb(p: Path) -> str:
    return f"{p.stat().st_size:,} bájt ({p.stat().st_size / 1024 / 1024:.0f} MB)"


def main() -> int:
    if not SRC.exists():
        print(f"Nincs meg: {SRC}\nElőbb futtasd: python scripts/export-nytk.py", file=sys.stderr)
        return 1

    print(f"forrás: {mb(SRC)}")

    t0 = time.time()
    # Alakzat-levezetés előbb: enélkül a tömörítő több csomópontot kihagy, és a
    # végeredmény nagyobb és lassabb lesz.
    #
    # A jelképes levezetés a huBERT gráfján nem fut végig hiánytalanul, és
    # ilyenkor kivételt dob. Ez nem baj: a tömörítés a statikus alakzatokból is
    # elvégezhető, csak néhány csomópont marad ki. Ezért ha elakad, jelezzük, és
    # a jelképes lépés nélkül próbáljuk újra — de nem hallgatjuk el.
    try:
        quant_pre_process(str(SRC), str(PREP), skip_symbolic_shape=False)
    except Exception as exc:  # noqa: BLE001 — a pontos típus verziófüggő
        print(f"  a jelképes alakzat-levezetés elakadt ({exc}); nélküle folytatjuk")
        quant_pre_process(str(SRC), str(PREP), skip_symbolic_shape=True)
    print(f"előkészítve: {mb(PREP)} ({time.time() - t0:.1f} s)")

    t1 = time.time()
    quantize_dynamic(
        model_input=str(PREP),
        model_output=str(DST),
        # A súlyok előjeles 8 bites egészek. A BERT-féle kódolóknál ez a bevált
        # párosítás; az előjel nélküli változat egyes processzorokon pontatlanabb.
        weight_type=QuantType.QInt8,
        # Csatornánkénti skálázás. Egyetlen közös szorzót az egész súlymátrixra
        # a ritka, kiugró súlyok elrontanak — márpedig a ritka alakokat épp
        # azok kódolják. A mérés szerint enélkül a modell elveszti az e-mail
        # címekbe ágyazott, ékezet nélküli névtöredékeket („kovacs", „janos58").
        per_channel=True,
        # Szűkített értéktartomány: néhány processzor 8 biten túlcsordul a
        # részösszegek felhalmozásakor, és ez csendes hibát okoz.
        reduce_range=True,
        nodes_to_exclude=[],
        extra_options={"MatMulConstBOnly": True},
    )
    print(f"tömörítve:  {mb(DST)} ({time.time() - t1:.1f} s)")

    PREP.unlink(missing_ok=True)

    ratio = SRC.stat().st_size / DST.stat().st_size
    print(f"arány: {ratio:.2f}×")

    meta = MODEL_DIR / "PROVENANCE.md"
    if meta.exists():
        text = meta.read_text(encoding="utf-8")
        note = (
            f"\n## 8 bites változat\n\n"
            f"- `model.int8.onnx` — {DST.stat().st_size:,} bájt, "
            f"a lebegőpontos változat {ratio:.2f}-szeresére tömörítve\n"
            f"- eszköz: onnxruntime.quantization.quantize_dynamic, QInt8, csak súlyok\n"
            f"- a `scripts/quantize-nytk.py` állította elő a `model.onnx`-ből\n"
        )
        if "## 8 bites változat" not in text:
            meta.write_text(text + note, encoding="utf-8")

    print(json.dumps({"src": SRC.stat().st_size, "int8": DST.stat().st_size}, indent=1))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
