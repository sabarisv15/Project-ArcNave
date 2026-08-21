# Architecture Conformance Report — v1.0 Baseline

**Tag:** `v1.0-architecture-conformant`
**Commit:** `aea2f40a9d64ef8c9c2b31c2ba92672c0b7564e5`
**Date:** 2026-07-26

## Rule conformance (155 total, `docs/bka/10-specification/`)

| State | Count |
|---|---|
| Conformant | 153 |
| Partial | 1 |
| Not built | 1 |
| Divergent | 0 |
| Undecided | 0 |

## Test suite

1483/1483 passing (`node --test`, backend).

## Remaining intentional exceptions

- **RS-IDN-012 (Partial)** — backend title lookup built; no frontend surface renders it yet, deliberately deferred until a real screen needs it.
- **RS-DAT-005 (Operational)** — document-storage backup/restore drill; currently in development, not deferred.

## Purpose

This is the reference baseline for the start of UAT. Any future architecture audit should diff against this commit/tag, not re-derive conformance from scratch.
