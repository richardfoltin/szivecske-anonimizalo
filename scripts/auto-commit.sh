#!/usr/bin/env bash
#
# auto-commit.sh — Claude Code Stop hook.
#
# Amikor a segéd befejez egy kört, ez a szkript megnézi, mennyi munka gyűlt
# össze, és ha elért egy küszöböt, elmenti egy `wip:` commitba. NEM PUSHOL:
# a feltöltés emberi döntés marad.
#
# A minta a Logiscool-Frontend/scripts/auto-commit.sh — a küszöb, a
# sorszámolás és az üzenet alakja onnan való. AMIBEN ITT TÖBB, az egyetlen
# dolog, és ez a projekt természetéből következik: ez a program magyar jogi
# iratokat anonimizál, tehát a munkakönyvtárba bármikor kerülhet VALÓDI
# ügyirat vagy visszafejtő kulcsfájl. Egy `git add -A`, ami emberi pillantás
# nélkül fut le minden körben, pont ezt a fájlt commitolná be — a git
# előzményéből pedig utólag kitörölni fájdalmas.
#
# Ezért a szkript a commit ELŐTT megnézi, MIT venne fel, és ha veszélyes
# mintát talál, NEM COMMITOL, hanem kiír egy figyelmeztetést. A `.gitignore`
# ugyanezeket a mintákat már kizárja; ez a második zár, arra az esetre, ha
# valaki a `.gitignore`-t átírja, vagy `git add -f`-fel felvesz valamit.

set -uo pipefail

# Ennyi változott sor fölött commitolunk. Egy új fájl 10 sornak számít: a puszta
# létezése is döntés, akkor is, ha még rövid.
KUSZOB=30

cd "${CLAUDE_PROJECT_DIR:-.}" 2>/dev/null || exit 0
git rev-parse --git-dir > /dev/null 2>&1 || exit 0

KOVETETT=$(git diff HEAD --name-only 2>/dev/null)
UJ=$(git ls-files --others --exclude-standard 2>/dev/null)

if [ -z "$KOVETETT" ] && [ -z "$UJ" ]; then
  exit 0
fi

# ── A VÉSZFÉK ──────────────────────────────────────────────────────────────
#
# Amit soha nem szabad automatikusan commitolni. A minták szándékosan tágabbak
# a `.gitignore`-énál: itt a tévedés iránya az, hogy inkább ne commitoljunk.
#
#   *.szkulcs        a visszafejtő kulcsfájl — ezzel az álnevesítés visszafordítható
#   *.pdf/.docx/...  bárhol a fán (a samples/ és a spike/out/ kivételével: azok
#                    szintetikus tesztadatok, és követve is vannak)
#   .env, *.pfx      titkok
#   hf_/ghp_/sk-     hozzáférési tokenek a fájl TARTALMÁBAN
#
GYANUS=$(printf '%s\n%s\n' "$KOVETETT" "$UJ" | grep -v '^$' | grep -E \
  -e '\.szkulcs$' \
  -e '\.(pfx|p12|pem|key)$' \
  -e '(^|/)\.env' \
  -e '\.(pdf|docx|doc|rtf|xlsx)$' \
  | grep -v -E '^(samples|spike/out)/' || true)

if [ -n "$GYANUS" ]; then
  echo "auto-commit: NEM commitolok. Olyan fájl került a fába, ami valódi iratot vagy titkot hordozhat:" >&2
  echo "$GYANUS" | sed 's/^/  /' >&2
  echo "Nézd át, és ha rendben van, commitold kézzel — vagy tedd a .gitignore-ba." >&2
  exit 0
fi

# Token a fájlok TARTALMÁBAN. Csak az újakat és a módosítottakat nézzük végig,
# nem az egész fát: a szkript minden körben lefut, és nem lassíthat.
TOKENES=$(printf '%s\n%s\n' "$KOVETETT" "$UJ" | grep -v '^$' | while read -r f; do
  [ -f "$f" ] || continue
  if LC_ALL=C grep -qE '(hf_[A-Za-z0-9]{20,}|ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|sk-[A-Za-z0-9]{20,})' "$f" 2>/dev/null; then
    echo "$f"
  fi
done)

if [ -n "$TOKENES" ]; then
  echo "auto-commit: NEM commitolok. Hozzáférési tokenre emlékeztető minta van ezekben:" >&2
  echo "$TOKENES" | sed 's/^/  /' >&2
  exit 0
fi

# ── A küszöb ───────────────────────────────────────────────────────────────

KOVETETT_SOROK=$(git diff HEAD --numstat 2>/dev/null | awk '{s+=$1+$2} END {printf "%d", s}')
UJ_DB=$(echo "$UJ" | grep -c '' 2>/dev/null)
[ -z "$UJ" ] && UJ_DB=0
KOVETETT_SOROK=${KOVETETT_SOROK:-0}

OSSZES=$((KOVETETT_SOROK + UJ_DB * 10))

if [ "$OSSZES" -lt "$KUSZOB" ]; then
  exit 0
fi

AG=$(git rev-parse --abbrev-ref HEAD 2>/dev/null)
KOVETETT_DB=$(echo "$KOVETETT" | grep -c '' 2>/dev/null)
[ -z "$KOVETETT" ] && KOVETETT_DB=0
FAJLOK=$((KOVETETT_DB + UJ_DB))

git add -A 2>/dev/null

git commit -q -m "wip: automata mentés [${AG}] — ${FAJLOK} fájl, ~${OSSZES} sor

Ez a commit a munka közbeni állapotot rögzíti, nem kész változat: a
tesztkészlet nem futott le rá. A `wip:` előtag ezt mondja ki.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>" 2>/dev/null

exit 0
