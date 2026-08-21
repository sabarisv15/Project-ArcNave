#!/usr/bin/env bash
#
# ARCNAVE Business Knowledge Architecture — artefact generation.
#
# Markdown under docs/ is the source of truth. PDF and DOCX are GENERATED
# artefacts and are never edited directly or committed.
#
# Requires: pandoc. PDF additionally requires a LaTeX engine (xelatex).
#
# Usage:
#   ./tools/export.sh              # both PDF and DOCX
#   ./tools/export.sh pdf          # PDF only
#   ./tools/export.sh docx         # DOCX only
#
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DOCS="$ROOT/docs"
DIST="$ROOT/dist"
BUILD="$ROOT/.build"
TITLE="ARCNAVE Business Knowledge Architecture"
SUBTITLE="Enterprise Architecture Specification — Edition 1.0"

command -v pandoc >/dev/null 2>&1 || {
  echo "error: pandoc not found. Install it, then re-run." >&2; exit 1;
}

mkdir -p "$DIST" "$BUILD"

# Assembly order mirrors mkdocs.yml nav exactly. Keep the two in step.
FILES=(
  "index.md"
  "00-foundation/scope-and-conventions.md"
  "00-foundation/actor-model.md"
  "00-foundation/domain-model.md"
  "10-specification/index.md"
  "10-specification/RS-GOV-governance.md"
  "10-specification/RS-TEN-tenancy-security.md"
  "10-specification/RS-IDN-identity.md"
  "10-specification/RS-STF-staff.md"
  "10-specification/RS-CLS-classroom.md"
  "10-specification/RS-ACA-academic.md"
  "10-specification/RS-ATT-attendance.md"
  "10-specification/RS-STU-students.md"
  "10-specification/RS-FIN-finance.md"
  "10-specification/RS-ASM-assessment-documents.md"
  "10-specification/RS-WFL-workflow.md"
  "10-specification/RS-NTF-notifications.md"
  "10-specification/RS-AIG-ai-governance.md"
  "10-specification/RS-DAT-data-integrity.md"
  "20-matrices/dependency-graph.md"
  "20-matrices/lifecycle-matrix.md"
  "20-matrices/ai-capability-matrix.md"
  "20-matrices/historical-data-integrity.md"
  "20-matrices/implementation-impact-matrix.md"
  "30-decisions/index.md"
  "30-decisions/ledger.md"
  "30-decisions/adr-register.md"
  "90-appendix/glossary.md"
  "90-appendix/traceability.md"
)

echo "==> validating before export"
python3 "$ROOT/tools/validate.py"

echo "==> assembling single-document source"
COMBINED="$BUILD/combined.md"
: > "$COMBINED"
for f in "${FILES[@]}"; do
  [ -f "$DOCS/$f" ] || { echo "error: missing $f" >&2; exit 1; }
  # Strip cross-document link targets: in a single combined document the file
  # part is meaningless and the anchor alone resolves correctly.
  sed -E 's#\]\(([^)#]*\.md)#](#g' "$DOCS/$f" >> "$COMBINED"
  printf '\n\n\\newpage\n\n' >> "$COMBINED"
done

METADATA="$BUILD/metadata.yaml"
cat > "$METADATA" <<YAML
---
title: "$TITLE"
subtitle: "$SUBTITLE"
date: "$(date +%Y-%m-%d)"
lang: en-GB
toc: true
toc-depth: 3
numbersections: false
colorlinks: true
linkcolor: RoyalBlue
urlcolor: RoyalBlue
geometry: "a4paper,margin=2.2cm"
mainfont: "DejaVu Serif"
sansfont: "DejaVu Sans"
monofont: "DejaVu Sans Mono"
fontsize: 10pt
---
YAML

TARGET="${1:-all}"

build_docx() {
  echo "==> DOCX"
  pandoc "$METADATA" "$COMBINED" \
    --from=markdown+pipe_tables+backtick_code_blocks+yaml_metadata_block \
    --to=docx \
    --toc --toc-depth=3 \
    --resource-path="$DOCS" \
    ${REFERENCE_DOCX:+--reference-doc="$REFERENCE_DOCX"} \
    --output="$DIST/ARCNAVE-BKA.docx"
  echo "    $DIST/ARCNAVE-BKA.docx"
}

build_pdf() {
  echo "==> PDF"
  if ! command -v xelatex >/dev/null 2>&1; then
    echo "    warning: xelatex not found — skipping PDF." >&2
    echo "    install a TeX distribution, or generate the PDF from the DOCX." >&2
    return 0
  fi
  pandoc "$METADATA" "$COMBINED" \
    --from=markdown+pipe_tables+backtick_code_blocks+yaml_metadata_block \
    --pdf-engine=xelatex \
    --toc --toc-depth=3 \
    --resource-path="$DOCS" \
    --output="$DIST/ARCNAVE-BKA.pdf"
  echo "    $DIST/ARCNAVE-BKA.pdf"
}

case "$TARGET" in
  pdf)  build_pdf ;;
  docx) build_docx ;;
  all)  build_docx; build_pdf ;;
  *)    echo "usage: $0 [pdf|docx|all]" >&2; exit 2 ;;
esac

echo "==> done"
echo
echo "Reminder: PDF and DOCX are generated artefacts."
echo "Edit docs/*.md and re-run. Never edit dist/ directly."
