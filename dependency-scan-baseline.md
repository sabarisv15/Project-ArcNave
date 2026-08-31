# Dependency scan baseline

ARCNAVE modernization P0 (item 3: "Turn on dependency scanning; list
the outdated ones"). Recorded 2026-08-31, `npm audit` against each
package's real lockfile — CI (`.github/workflows/ci.yml`) runs this on
every PR and reports it; it does not yet fail the build (see "Why
informational, not blocking" below).

## Backend (`backend/`) — 6 vulnerabilities: 4 high, 2 moderate

| package | severity | via | fix |
|---|---|---|---|
| `image-size` (→ `pptxgenjs`) | high | ICNS/JXL/HEIF parser infinite-loop DoS | `npm audit fix --force` → `pptxgenjs@1.1.5` (**major downgrade** from the currently pinned `^4.0.1` — real API surface change for the PPTX-export feature; needs its own regression pass against `backend/skills/pptx`) |
| `node-pg-migrate` (dev-only) | high | transitive, migration tooling only, never runs in the request path | tracked, not yet fixed |
| `uuid` (→ `exceljs`) | moderate | missing buffer bounds check in v3/v5/v6 | `npm audit fix --force` → `exceljs@3.4.0` (breaking; XLSX export feature) |

## Frontend (`frontend/`) — 7 vulnerabilities: 1 critical, 1 high, 5 moderate

| package | severity | via | fix |
|---|---|---|---|
| `vitest`/`@vitest/mocker` | critical | arbitrary file read/execute when the Vitest UI server is listening — **dev/test tooling only, never shipped in `npm run build`'s output** | needs `vitest@3` (currently pinned `^2.1.4`) — breaking, has its own config surface |
| `vite` | high | path traversal in optimized-deps `.map` handling, `server.fs.deny` bypass on Windows — **dev server only, not the production build artifact** | needs `vite@7` (currently pinned `^5.4.0`) — breaking |
| `react-router-dom` | moderate | open redirect via backslash in `<Link>`/`useNavigate`; arbitrary constructor injection in SSR hydration (this app doesn't use SSR) | `npm audit fix --force` → `react-router-dom@7.18.3` (currently pinned `^6.27.0` — a major-version routing API change, real regression risk across every route in the app) |

## Why informational, not blocking (yet)

Every fix available today requires a breaking major-version bump of a
package this app actively depends on for a real, shipping feature
(PPTX/XLSX export, client-side routing) or a dev-tooling package
(Vite/Vitest) with its own config surface. Force-upgrading blind in
this CI-setup slice — with no time to verify PPTX/XLSX output or every
route still works — is a real regression risk the modernization
mandate's own "business rule / new investment" stop conditions don't
clearly resolve on their own (this is a correctness-risk judgment call,
not a business rule or a cost question). `npm audit` runs on every PR
either way, so the finding stays visible; each upgrade is its own
scoped follow-up pass (P2/P3 territory — "upgrade the framework
version" is already a named P1/P3 item in
`ARCNAVE-modernization-english.md`), not silently deferred.

**Real-world exposure today:** the two frontend criticals/highs are
both dev-server-only (Vitest UI / Vite dev server), not present in
`npm run build`'s shipped bundle — lower urgency than the CVSS number
alone suggests. The backend highs are a DoS in an image-format parser
reachable only through document export tooling, and a dev-only
migration-tool transitive dependency.

## Outdated packages

`npm outdated` (both packages) is long — re-run
`npm outdated` in `backend/` and `frontend/` for the current list
rather than duplicating a snapshot here that goes stale immediately;
the audit table above is what actually matters (known vulnerabilities,
not just "a newer version exists").
