# Dependency scan baseline

ARCNAVE modernization P0 (item 3: "Turn on dependency scanning; list
the outdated ones"). `npm audit` against each package's real
lockfile — CI (`.github/workflows/ci.yml`) runs this on every PR and
reports it; it does not fail the build by itself (see "Why
informational, not blocking" below).

**P5 (O5) update, 2026-09-03: a real regression gate now sits on top
of this informational report.** `<package>/scripts/audit-policy-gate.js`
(backend) / `.cjs` (frontend) reads `npm audit --json` and fails CI on
any HIGH/CRITICAL advisory not already listed in that package's
`audit-allowlist.json` — every advisory recorded below as "accepted"
is in that file, with the same reasoning duplicated there so the
allowlist is self-explaining without cross-referencing this doc. A
*new* high/critical advisory in a future dependency bump fails the
build immediately; it is never silently absorbed the way this table's
own entries currently are. MODERATE/LOW findings stay informational
only (this table still lists them for visibility).

Also re-verified against real `npm audit --json` output this pass —
the previous version of this table (recorded 2026-08-31) was already
stale: `glob`/`@xmldom/xmldom` are new since then, `node-pg-migrate`'s
listed advisory disappeared (its own dependency tree resolved
differently), and the frontend gained `esbuild`/`react-router`/
`vite-node` entries. Re-run `npm audit --json` yourself before trusting
this table blindly for anything beyond "the reasoning pattern" — see
`../30-decisions/ledger.md`'s ADL-086 note on this same drift.

## Backend (`backend/`) — 5 vulnerabilities: 3 high, 2 moderate

| package | severity | advisory | accepted? | fix |
|---|---|---|---|---|
| `glob` (→ `node-pg-migrate`, dev-only) | high | [GHSA-5j98-mcp5-4vw2](https://github.com/advisories/GHSA-5j98-mcp5-4vw2) — CLI command injection | ✅ allowlisted | needs a `node-pg-migrate` major bump; never invoked as a CLI, dev-only, never in the request path |
| `image-size` (→ `pptxgenjs`) | high | [GHSA-w3rx-r6r6-pgpr](https://github.com/advisories/GHSA-w3rx-r6r6-pgpr) — ICNS parser DoS | ✅ allowlisted | `npm audit fix --force` → `pptxgenjs@1.1.5` (major downgrade from pinned `^4.0.1`, real API-surface change, needs its own regression pass) |
| `image-size` (→ `pptxgenjs`) | high | [GHSA-5p2g-fcmc-qvqq](https://github.com/advisories/GHSA-5p2g-fcmc-qvqq) — JXL/HEIF parser DoS | ✅ allowlisted | same fix/blocker as above |
| `@xmldom/xmldom` (→ `docxtemplater`) | moderate | [GHSA-6gmq-8vp8-gcm6](https://github.com/advisories/GHSA-6gmq-8vp8-gcm6) — XML fragment injection | informational only | not yet triaged for a fix path |
| `uuid` (→ `exceljs`) | moderate | [GHSA-w5hq-g745-h8pq](https://github.com/advisories/GHSA-w5hq-g745-h8pq) — missing buffer bounds check | informational only | `npm audit fix --force` → `exceljs@3.4.0` (breaking; XLSX export feature) |

## Frontend (`frontend/`) — 6 vulnerabilities: 1 critical, 1 high, 4 moderate

| package | severity | advisory | accepted? | fix |
|---|---|---|---|---|
| `vitest` | critical | [GHSA-5xrq-8626-4rwp](https://github.com/advisories/GHSA-5xrq-8626-4rwp) — arbitrary file read/execute when the Vitest UI server is listening | ✅ allowlisted | dev/test tooling only, never shipped in `npm run build`'s output, UI server never started in this repo's workflow. Needs `vitest@3` (currently pinned `^2.1.4`) — breaking |
| `vite` | high | [GHSA-fx2h-pf6j-xcff](https://github.com/advisories/GHSA-fx2h-pf6j-xcff) — `server.fs.deny` bypass on Windows alternate paths | ✅ allowlisted | dev server only, not in the production build artifact. Needs `vite@7` (currently pinned `^5.4.0`) — breaking |
| `vite` | moderate | [GHSA-4w7w-66w2-5vf9](https://github.com/advisories/GHSA-4w7w-66w2-5vf9) — path traversal in optimized-deps `.map` handling | informational only | same `vite@7` fix as above |
| `vite` (→ `launch-editor`) | moderate | [GHSA-v6wh-96g9-6wx3](https://github.com/advisories/GHSA-v6wh-96g9-6wx3) — NTLMv2 hash disclosure via UNC path on Windows | informational only | dev-only, transitive |
| `esbuild` | moderate | [GHSA-67mh-4wv8-2f99](https://github.com/advisories/GHSA-67mh-4wv8-2f99) — dev server accepts requests from any website | informational only | dev server only |
| `react-router` (→ `react-router-dom`) | moderate | [GHSA-wrjc-x8rr-h8h6](https://github.com/advisories/GHSA-wrjc-x8rr-h8h6) / [GHSA-337j-9hxr-rhxg](https://github.com/advisories/GHSA-337j-9hxr-rhxg) — open redirect / SSR hydration constructor injection (this app doesn't use SSR) | informational only | `npm audit fix --force` → `react-router-dom@7.18.3` (currently pinned `^6.27.0` — major routing-API change, real regression risk across every route) |

## Why informational, not blocking (for MODERATE/LOW, and for the allowlisted HIGH/CRITICAL above)

Every fix available today requires a breaking major-version bump of a
package this app actively depends on for a real, shipping feature
(PPTX/XLSX export, client-side routing) or a dev-tooling package
(Vite/Vitest) with its own config surface. Force-upgrading blind — with
no time to verify PPTX/XLSX output or every route still works — is a
real regression risk. `npm audit` runs on every PR either way, so the
finding stays visible; each upgrade is its own scoped follow-up pass
(P2/P3 territory — "upgrade the framework version" is already a named
P1/P3 item in `ARCNAVE-modernization-english.md`), not silently
deferred. The P5 policy gate above changes what "not yet fixed" means
in practice: these specific advisories are a recorded, allowlisted
accepted risk, not just an unenforced report — and anything NOT on this
table's accepted list still fails CI the moment it appears.

**Real-world exposure today:** the frontend critical/high are both
dev-server-only (Vitest UI / Vite dev server), not present in
`npm run build`'s shipped bundle. The backend highs are a DoS in an
image-format parser reachable only through document-export tooling
this app never exercises that code path of, and a dev-only
migration-tool transitive dependency never invoked as a CLI.

## Outdated packages

`npm outdated` (both packages) is long — re-run
`npm outdated` in `backend/` and `frontend/` for the current list
rather than duplicating a snapshot here that goes stale immediately;
the audit table above is what actually matters (known vulnerabilities,
not just "a newer version exists").
