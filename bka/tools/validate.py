#!/usr/bin/env python3
"""
ARCNAVE Business Knowledge Architecture — structural integrity validator.

Enforces the properties the specification's single-source-of-truth guarantee
depends on. Exits non-zero on any error, so it is safe as a CI gate or a
pre-commit hook.

Checks
------
  1. Rule identifiers are unique and well-formed.
  2. Every rule carries all twelve mandatory metadata fields.
  3. Conformance values come from the closed vocabulary.
  4. Every intra-repository link resolves to a real file.
  5. Every link anchor resolves to a real heading in the target file.
  6. Every referenced RS / ADL / ADR identifier is defined somewhere.
  7. Dependency edges are symmetric: A depends on B implies B governs A.
  8. The dependency graph is acyclic.
  9. No rule is orphaned (neither depends on nor governs anything).
 10. Markdown tables have a consistent column count.

Usage
-----
    python tools/validate.py [--strict]

    --strict   Treat warnings as errors.
"""

from __future__ import annotations

import re
import sys
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DOCS = ROOT
SPEC = DOCS / "10-specification"

DOMAINS = {
    "GOV", "TEN", "IDN", "STF", "CLS", "ACA",
    "ATT", "STU", "FIN", "ASM", "WFL", "NTF", "AIG", "DAT",
    "ANL", "ADM",  # added 2026-07-25: Analytics Governance, Admission Wizard
    "PRF",  # added 2026-08-21: Personal Workspace — real domain, was missing from this set
}

MANDATORY_FIELDS = [
    "Owner", "Authority", "Depends on", "Governs", "Lifecycle", "Workflow",
    "AI", "Modules", "Data effect", "Implementation", "Conformance",
    "Decisions",
]

CONFORMANCE_VOCAB = {"Conformant", "Divergent", "Not built", "Undecided"}

RULE_HEADING = re.compile(r"^##\s+(RS-[A-Z]{3}-\d{3})\s*$", re.M)
LEDGER_HEADING = re.compile(r"^##\s+(ADL-\d{3})\s*$", re.M)
ADR_HEADING = re.compile(r"^###\s+(ADR-\d{3})\s*$", re.M)
ANY_HEADING = re.compile(r"^(#{1,6})\s+(.*?)\s*$", re.M)
MD_LINK = re.compile(r"\[[^\]]*\]\(([^)\s]+)\)")
RULE_REF = re.compile(r"\b(RS-[A-Z]{3}-\d{3})\b")
ADL_REF = re.compile(r"\b(ADL-\d{3})\b")
ADR_REF = re.compile(r"\b(ADR-\d{3})\b")

errors: list[str] = []
warnings: list[str] = []


def err(msg: str) -> None:
    errors.append(msg)


def warn(msg: str) -> None:
    warnings.append(msg)


def slug(heading_text: str) -> str:
    """Reproduce the anchor slug MkDocs/python-markdown generates."""
    s = heading_text.strip().lower()
    s = re.sub(r"`|\*|_", "", s)
    s = re.sub(r"\[([^\]]*)\]\([^)]*\)", r"\1", s)  # link text only
    s = re.sub(r"[^\w\s-]", "", s)
    s = re.sub(r"[\s]+", "-", s.strip())
    return s


def md_files() -> list[Path]:
    return sorted(DOCS.rglob("*.md"))


# --------------------------------------------------------------------------
# Load
# --------------------------------------------------------------------------

texts: dict[Path, str] = {p: p.read_text(encoding="utf-8") for p in md_files()}
anchors: dict[Path, set[str]] = {}
for path, text in texts.items():
    found = set()
    for _, heading in ANY_HEADING.findall(text):
        found.add(slug(heading))
    anchors[path] = found

# --------------------------------------------------------------------------
# 1. Rule identifiers
# --------------------------------------------------------------------------

rule_home: dict[str, Path] = {}
rule_body: dict[str, str] = {}

for path in sorted(SPEC.glob("RS-*.md")):
    text = texts[path]
    matches = list(RULE_HEADING.finditer(text))
    for i, m in enumerate(matches):
        rid = m.group(1)
        domain = rid.split("-")[1]
        if domain not in DOMAINS:
            err(f"{path.name}: unknown domain code in {rid}")
        expected = path.name.split("-")[1]
        if domain != expected:
            err(f"{path.name}: rule {rid} lives in the wrong domain file")
        if rid in rule_home:
            err(f"duplicate rule identifier {rid} "
                f"({rule_home[rid].name} and {path.name})")
        rule_home[rid] = path
        end = matches[i + 1].start() if i + 1 < len(matches) else len(text)
        rule_body[rid] = text[m.end():end]

if not rule_home:
    err("no rules found — specification layer is empty or misnamed")

# Ordinals contiguous per domain
by_domain: dict[str, list[int]] = defaultdict(list)
for rid in rule_home:
    by_domain[rid.split("-")[1]].append(int(rid.split("-")[2]))
for domain, nums in sorted(by_domain.items()):
    nums.sort()
    if nums != list(range(1, len(nums) + 1)):
        warn(f"{domain}: ordinals are not contiguous from 001 — {nums}")

# --------------------------------------------------------------------------
# 2-3. Metadata completeness and conformance vocabulary
# --------------------------------------------------------------------------

depends: dict[str, set[str]] = defaultdict(set)
governs: dict[str, set[str]] = defaultdict(set)


def field_value(body: str, name: str) -> str | None:
    pattern = re.compile(
        r"^\|\s*\*\*" + re.escape(name) + r"\*\*\s*\|(.*?)\|\s*$", re.M
    )
    m = pattern.search(body)
    return m.group(1).strip() if m else None


for rid, body in rule_body.items():
    for field in MANDATORY_FIELDS:
        value = field_value(body, field)
        if value is None:
            err(f"{rid}: missing mandatory metadata field '{field}'")
            continue
        if value == "":
            err(f"{rid}: metadata field '{field}' is empty (use '—')")
        if field == "Conformance":
            if not any(v in value for v in CONFORMANCE_VOCAB):
                err(f"{rid}: conformance value not in the closed vocabulary "
                    f"-> {value!r}")
        if field == "Depends on":
            depends[rid] = set(RULE_REF.findall(value))
        if field == "Governs":
            governs[rid] = set(RULE_REF.findall(value))

# --------------------------------------------------------------------------
# 4-5. Link and anchor resolution
# --------------------------------------------------------------------------

for path, text in texts.items():
    for target in MD_LINK.findall(text):
        if target.startswith(("http://", "https://", "mailto:")):
            continue
        file_part, _, anchor = target.partition("#")
        if file_part:
            resolved = (path.parent / file_part).resolve()
            if not resolved.exists():
                err(f"{path.relative_to(ROOT)}: broken link -> {target}")
                continue
        else:
            resolved = path
        if anchor:
            known = anchors.get(resolved)
            if known is not None and anchor not in known:
                err(f"{path.relative_to(ROOT)}: unresolved anchor -> {target}")

# --------------------------------------------------------------------------
# 6. Dangling identifiers
# --------------------------------------------------------------------------

ledger = DOCS / "30-decisions" / "ledger.md"
adr = DOCS / "30-decisions" / "adr-register.md"
defined_adl = set(LEDGER_HEADING.findall(texts.get(ledger, "")))
defined_adr = set(ADR_HEADING.findall(texts.get(adr, "")))

for path, text in texts.items():
    for rid in set(RULE_REF.findall(text)):
        if rid not in rule_home:
            err(f"{path.relative_to(ROOT)}: reference to undefined rule {rid}")
    for aid in set(ADL_REF.findall(text)):
        if aid not in defined_adl:
            err(f"{path.relative_to(ROOT)}: reference to undefined {aid}")
    for aid in set(ADR_REF.findall(text)):
        if aid not in defined_adr:
            err(f"{path.relative_to(ROOT)}: reference to undefined {aid}")

# Every rule should be cited at least once outside its own domain file
for rid, home in rule_home.items():
    cited = any(
        rid in text for p, text in texts.items() if p != home
    )
    if not cited:
        warn(f"{rid}: never referenced outside its own domain file")

# --------------------------------------------------------------------------
# 7. Dependency symmetry
# --------------------------------------------------------------------------

for rid, deps in depends.items():
    for dep in deps:
        if dep not in rule_home:
            continue
        if rid not in governs.get(dep, set()):
            warn(f"asymmetric edge: {rid} depends on {dep}, "
                 f"but {dep} does not govern {rid}")

for rid, govs in governs.items():
    for gov in govs:
        if gov not in rule_home:
            continue
        if rid not in depends.get(gov, set()):
            warn(f"asymmetric edge: {rid} governs {gov}, "
                 f"but {gov} does not depend on {rid}")

# --------------------------------------------------------------------------
# 8. Acyclicity
# --------------------------------------------------------------------------

WHITE, GREY, BLACK = 0, 1, 2
colour: dict[str, int] = {r: WHITE for r in rule_home}
reported: set[tuple[str, ...]] = set()


def visit(node: str, stack: list[str]) -> None:
    colour[node] = GREY
    stack.append(node)
    for nxt in sorted(depends.get(node, ())):
        if nxt not in colour:
            continue
        if colour[nxt] == GREY:
            cycle = tuple(stack[stack.index(nxt):] + [nxt])
            if cycle not in reported:
                reported.add(cycle)
                err("dependency cycle: " + " -> ".join(cycle))
        elif colour[nxt] == WHITE:
            visit(nxt, stack)
    stack.pop()
    colour[node] = BLACK


sys.setrecursionlimit(10000)
for r in sorted(rule_home):
    if colour[r] == WHITE:
        visit(r, [])

# --------------------------------------------------------------------------
# 9. Orphans
# --------------------------------------------------------------------------

for rid in sorted(rule_home):
    if not depends.get(rid) and not governs.get(rid):
        warn(f"{rid}: orphaned — neither depends on nor governs any rule")

# --------------------------------------------------------------------------
# 10. Table column consistency
# --------------------------------------------------------------------------

for path, text in texts.items():
    lines = text.splitlines()
    block: list[tuple[int, int]] = []
    in_fence = False
    for n, line in enumerate(lines, start=1):
        if line.lstrip().startswith("```"):
            in_fence = not in_fence
            continue
        stripped = line.strip().replace("\\|", "")
        is_row = (not in_fence and stripped.startswith("|")
                  and stripped.endswith("|"))
        if is_row:
            block.append((n, stripped.count("|")))
        else:
            if len(block) >= 2:
                widths = {w for _, w in block}
                if len(widths) > 1:
                    first = block[0][0]
                    warn(f"{path.relative_to(ROOT)}:{first}: "
                         f"table has inconsistent column counts {sorted(widths)}")
            block = []
    if len(block) >= 2:
        widths = {w for _, w in block}
        if len(widths) > 1:
            warn(f"{path.relative_to(ROOT)}:{block[0][0]}: "
                 f"table has inconsistent column counts {sorted(widths)}")

# --------------------------------------------------------------------------
# Report
# --------------------------------------------------------------------------

strict = "--strict" in sys.argv

print("ARCNAVE BKA — structural integrity")
print("=" * 60)
print(f"  documents          {len(texts)}")
print(f"  rules              {len(rule_home)}")
for domain in sorted(by_domain):
    print(f"    {domain}              {len(by_domain[domain]):>3}")
print(f"  ledger entries     {len(defined_adl)}")
print(f"  decision records   {len(defined_adr)}")
print(f"  dependency edges   {sum(len(v) for v in depends.values())}")
print("=" * 60)

for w in warnings:
    print(f"  WARN   {w}")
for e in errors:
    print(f"  ERROR  {e}")

print("-" * 60)
print(f"  {len(errors)} error(s), {len(warnings)} warning(s)")

if errors or (strict and warnings):
    print("  FAILED")
    sys.exit(1)
print("  PASSED")
sys.exit(0)
