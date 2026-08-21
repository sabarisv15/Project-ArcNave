# ARCNAVE Business Knowledge Architecture

Enterprise Architecture Specification — Edition 1.0, baselined 2026-07-25.

A **connected specification** of ARCNAVE's business knowledge: 147 canonical
rules, each carrying explicit dependency, governance, lifecycle, ownership,
workflow, AI, module and implementation references, plus five derived matrices
and a complete decision ledger.

Markdown is the source of truth. PDF and DOCX are generated artefacts.

---

## Layout

```
docs/
  index.md                       Overview, structure, precedence
  00-foundation/                 Conventions · actor model · domain model
  10-specification/              THE CANONICAL RULE SET — authoritative
  20-matrices/                   Derived views (dependency · lifecycle · AI · data · impact)
  30-decisions/                  Decision Ledger · ADR Register
  90-appendix/                   Glossary · traceability
tools/
  validate.py                    Structural integrity validator
  export.sh                      PDF and DOCX generation
.github/workflows/docs.yml       Validate → build → publish
mkdocs.yml                       Site configuration
```

## Core principle

> Every statement has exactly one home. Every other occurrence is a
> cross-reference.

Prose restatement of another rule's normative content is a specification
defect, not a stylistic preference — it is how the previous estate accumulated
contradictions. `tools/validate.py` enforces the structural half of this
mechanically.

## Precedence

1. Specification layer (`10-specification/`)
2. Foundation layer (`00-foundation/`)
3. Decision Ledger — binding for rationale and migration obligation only
4. Everything else is derived or informative

**Code is never the arbiter of a rule.** Where they disagree, the divergence is
recorded in the Implementation Impact Matrix and the code is corrected.

## Quick start

```bash
pip install mkdocs-material
python tools/validate.py        # structural integrity — must pass
mkdocs serve                    # http://127.0.0.1:8000
mkdocs build                    # static site → site/
./tools/export.sh               # PDF + DOCX → dist/
```

## Validator

`tools/validate.py` fails the build on:

| Check | Failure condition |
|---|---|
| Identifier uniqueness | A rule identifier defined more than once |
| Identifier format | A heading that is not `RS-<DOM>-<NNN>` with a known domain |
| Cross-reference resolution | A link to a file or anchor that does not exist |
| Dangling identifier | A referenced rule, ledger entry or ADR that is not defined |
| Metadata completeness | A rule missing any of the twelve mandatory fields |
| Dependency symmetry | `A depends on B` without `B governs A` |
| Dependency acyclicity | A cycle in the dependency graph |
| Orphaned rule | A rule neither depending on nor governing anything |
| Conformance vocabulary | A conformance value outside the closed set |

It exits non-zero on any error, so it is safe as a CI gate and a pre-commit
hook.

## Amending a rule

1. Open a Decision Ledger entry — rationale, affected artefacts, migration
   impact, implementation notes.
2. Edit **exactly one** `RS-*` record.
3. Update `Depends on` / `Governs` on both sides of every affected edge.
4. Regenerate the affected matrices in the same change.
5. `python tools/validate.py` must pass.
6. Commit. Never edit a generated PDF or DOCX.

Full procedure:
[`docs/00-foundation/scope-and-conventions.md`](docs/00-foundation/scope-and-conventions.md).

## Open decisions

| ID | Subject | Gating |
|---|---|---|
| ADL-021 | Position level integer versus business L-number | **Blocks all identity-layer work** |
| ADL-020 | AI downstream scope fidelity | **Highest severity** — verify against code first |
| ADL-005 | Role-to-classification matrix ratification | Non-blocking |

## Conformance at baseline

| State | Count |
|---|---|
| Conformant | 96 |
| Divergent | 18 |
| Not built | 29 |
| Undecided | 4 |
| **Total** | **147** |

See
[`docs/20-matrices/implementation-impact-matrix.md`](docs/20-matrices/implementation-impact-matrix.md)
for the full position and the remediation sequence.
