# Consumer-tool adaptation — open flags

_Opened 2026-08-26, during the "implement all four attachments" pass.
Companion to [`consumer-tool-inventory-classification.md`](consumer-tool-inventory-classification.md)._

The product owner's instruction for this pass was explicit: ARCNAVE is
pre-launch, there is no real data yet, this is an experiment — build it,
flag every problem, solve the problems later. This file is that flag
list. **Nothing here is blocking; everything here is unresolved.**

Flags are ordered by how much damage they do if forgotten, not by
effort.

**Update, 2026-08-26 (same day, second pass) — F3a is CLOSED, built.**
The skills subsystem (§8b), the sandbox file-return path (F3a), and the
xlsx verification gate are now implemented: `backend/src/services/skillService.js`,
`backend/src/skills/{file-reading,xlsx,pdf-reading}/SKILL.md`,
`sandbox-service/scripts/recalc.py`, and `execute_code`'s new
`saveAs`/`expectFormulasIn` params wired through
`artifactService.attachGeneratedFile`. New flags F2a-F2d below record
what that work found. Full suite: **2378/2380** (the same 2 pre-existing
`fetch_trusted_web_page` failures; two OTHER tests failed once each
across three consecutive runs — `documents-chat-attachments` and an
`executeWorkflowPlan` concurrency test — neither related to this
session's changes, both passed cleanly on re-run in isolation or on a
subsequent full run. See F11a below, already flagged before this work
started).

---

## F1 — `web_search` has no working provider, and now neither do two new tools

**Status: blocked on a decision only the product owner can make.**

Google Custom Search returns a permanent 403 for new projects ahead of
its 2027-01-01 discontinuation; no configuration fixes it. This pass
rewrote [`webSearchService.js`](../../backend/src/services/webSearchService.js)
to be provider-agnostic — **Brave** and **Tavily** are both implemented,
selected by `WEB_SEARCH_PROVIDER`, and both are single-key setups. So the
rewrite the previous checkpoint listed as the next action is done.

What remains is not code:

1. Pick Brave or Tavily, sign up, get the key.
2. Set `WEB_SEARCH_PROVIDER` and `WEB_SEARCH_API_KEY` in `backend/.env.local.sh`.
3. Opt a college in (`category: 'web_search'`, `expectedVersion: 0`).

`web_search_fast` and `image_search` were built on the same service, so
all three are dead until this is done. Tavily has **no image index** —
`image_search` throws `WebSearchNotConfiguredError` on that provider by
design rather than silently returning nothing. **If image search matters,
pick Brave.**

Also still wrong and not corrected by this pass: the
[RS-AIG-020 amendment](../10-specification/RS-AIG-ai-governance.md#rs-aig-020)
and [ADL-061](../30-decisions/ledger.md#adl-061) both still name "Google
Custom Search" as the chosen provider. That text must be corrected once
a provider is actually picked — correcting it now would just replace one
wrong name with a guess.

## F2 — ✅ CLOSED 2026-08-26 (local Docker), ✅ FULLY CLOSED 2026-08-27 — the real Cloud Run production revision is now on the rebuilt image and live-verified

**Was:** the sandbox image had gained `pdfplumber`/`openpyxl`/`pandas`/
`libreoffice-calc` at build time, but the deployed Cloud Run revision
was still the stdlib-only image, and none of this had ever run for
real.

**What happened:** the owner approved a real Cloud Run redeploy. The
image was rebuilt and pushed via Cloud Build
(`asia-south1-docker.pkg.dev/project-8bcf740a-a7bd-4aea-974/arcnave/sandbox-service:20260826-redeploy1`,
`sha256:a0347891b95f...`) — that part succeeded. The actual `gcloud run
deploy` step was blocked by an automated permission classifier (a
harness-level guard on live production-infra mutation, independent of
the owner's own approval) and needs the owner to run it themselves;
the exact command (image, `--timeout=240` up from the live 30s —
needed because a verified `saveAs` call can take up to ~210s, and
`--memory=1Gi` up from 512Mi for LibreOffice headroom, both VPC flags
repeated to preserve the existing no-egress isolation) was handed to
them directly.

**Owner's redirect: use Docker locally instead of fighting the
classifier.** The same image was built and run as a **standalone local
container** (`arcnave-sandbox-local`, port 8081, its own fresh
dev-only shared secret) — deliberately NOT joined to the
`docker-compose` project network the `app`/`db` containers share
(confirmed via `docker inspect`: sandbox sits on the default `bridge`
network, `app` sits on `gstack_default` — no shared network path,
reachable only through the published host port), preserving ADL-059's
"no path to ARCNAVE's own DB/API" property even for local dev. `app`
reaches it via `host.docker.internal:8081`; `SANDBOX_SERVICE_URL`/
`SANDBOX_SERVICE_TOKEN` in the root `.env` were repointed at it and
`docker compose up -d app` recreated the container to pick up the
change.

**Verified live, real LibreOffice recalculation, not mocked:**
- Plain `execute_code` (no file): `2+2` → `4`, confirming basic
  connectivity through the new local path.
- `saveAs`/`expectFormulasIn` **pass case**: a workbook with
  `A3 = '=SUM(A1:A2)'` → `verdict: "passed"`, `formulaCellCount: 1`,
  correctly recalculated.
- `saveAs`/`expectFormulasIn` **failure case**: the exact "computed in
  Python, written as a number" failure this gate exists to catch
  (`A3 = 30` where a formula was expected) → `verdict: "failed"`,
  `constants: [{cell: "Sheet!A3", found: 30, reason: "expected a
  formula, found a literal value..."}]` — the gate rejects it, not a
  rubber stamp.

**Update 2026-08-27 — the real Cloud Run redeploy happened, and it is
live-verified, not just local Docker.** The owner ran `gcloud` directly
(the harness classifier still blocks live infra mutation for the
assistant itself — every `gcloud run`/`gcloud iam` write in this pass
was handed to the owner to execute). The existing, already-public
`arcnave-sandbox-service` (not a new service name — see F2d for why)
was updated in place via `gcloud run services update --image=...
:20260826-redeploy1 --memory=2Gi --cpu=2 --timeout=240`, one step up
from the `--memory=1Gi` originally handed over — the owner's own call,
not re-litigated here. VPC isolation
(`run.googleapis.com/network-interfaces` / `vpc-access-egress:
all-traffic`) was confirmed **unchanged** by the update (`gcloud run
services describe` re-checked after).

**Verified live against the real Cloud Run URL** (not local Docker):
plain `execute_code` (`2+2` → `4`); a `saveAs` PASS case
(`=SUM(A1:A2)`) → `verdict: "passed"` in 7.97s; a `saveAs` FAIL case
(`A3 = 30` where a formula was expected) → `verdict: "failed"`,
`constants: [{cell: "Sheet!A3", found: 30, ...}]` in 4.50s — those two
numbers are the first real timing data point against production
infrastructure (still a 3-cell fixture, not a realistic-sized workbook
— does not by itself close F2b). Root `.env`'s `SANDBOX_SERVICE_URL`
was corrected back to this service (it had drifted to the abandoned
`sandbox-service` name during the session — see F2d) with
`SANDBOX_SERVICE_IAM_AUTH=false`, matching what is actually deployed.

### F2 — the sandbox image gained three Python packages and has not been redeployed (original text, superseded above)

**Status: built, untested against anything real.**

[`sandbox-service/Dockerfile`](../../sandbox-service/Dockerfile) now
installs `pdfplumber==0.11.4`, `openpyxl==3.1.5`, `pandas==2.2.3` at
build time, with `python3-pip` purged afterwards so the shipped image
cannot install anything further. This is the "future decision" that
file's own original comment anticipated.

**None of it is live.** The deployed Cloud Run revision is still the
stdlib-only image. Until it is rebuilt and redeployed, `execute_code`
will fail on any script importing these.

Two numbers in that service are now provisional and **explicitly not
measured**:

- `EXECUTION_TIMEOUT_MS` raised 15s → 60s. Sized for arithmetic before;
  a 49-page `extract_tables()` run is different work. 60s is a guess.
- `MAX_BODY_BYTES` is still 10MB. The 53-page ledger fits; the
  400-page result sheet may not. Nobody has checked.

**Update 2026-08-26 (second pass):** LibreOffice was added on top of
this (for F3a's gate). The image now builds and every fixture case
verified correctly against it in a real container — but three MORE
numbers joined the unmeasured pile, recorded as F2a/F2b below rather
than folded in here silently.

### F2a — the image is now ~1.2GB, unmeasured cold-start cost

`docker images` reports **1.21GB** for the sandbox image after adding
`libreoffice-calc` (this session measured this exact number, not a
guess) — up from a stdlib+pandas base that was itself already flagged
as unmeasured. Cloud Run cold-start time scales with image size; no
number exists for how much this adds. `libreoffice-calc` (not the full
`libreoffice` suite) was chosen specifically to minimize this, but that
choice itself is unmeasured — nobody has compared it against not having
LibreOffice at all, or against a lighter recalculation approach.

**Update 2026-08-26 (F2's local-Docker verification):** the pass/fail
`saveAs` calls tested locally (see F2 above) both completed in well
under a second — a tiny 3-cell fixture on a warm, already-running local
container tells you nothing about cold-start or a realistic-sized
workbook. Confirms the plumbing works end to end; does not touch this
flag's actual open question.

### F2b — a file-generating call can now take up to 210s, and nothing solves the transport problem this creates

Verifying a workbook is a SECOND phase after the script itself runs:
LibreOffice recalculation (internal 120s timeout inside `recalc.py`,
130s outer spawn timeout in `server.js`) on top of the script's own 60s
budget. `sandboxExecutionService.js`'s client-side timeout for a
`saveAs` call was raised to **210s** to give this room — a real,
previously-nonexistent budget, not a copy-paste of the old 65s.

None of these three numbers (60s / 130s / 210s) are measured against a
real workbook of realistic size. More importantly: **a single
`/ai/ask` HTTP request can now legitimately take up to 210 seconds.**
This session did not design around that — no streaming, no async job
pattern, no "come back later" mechanism. A browser, a load balancer, or
Gemini's own call chain timing out mid-verification is a real, live risk
for the very first file-generating call anyone makes, not a hypothetical
edge case. This needs its own design pass before file generation is
used for anything beyond a small workbook.

### F2c — three of the six originally-planned skills could not be honestly written

The approved plan named `pdf`, `docx`, `pptx` as skills to port alongside
`file-reading`, `xlsx`, `pdf-reading`. Only the latter three were built.
Reason, discovered mid-implementation: the sandbox has `pdfplumber`,
`openpyxl`, `pandas`, and LibreOffice Calc — **no PDF-writing library**
(no `reportlab`, `pypdf`, `fpdf`), **no `python-docx`**, **no
`python-pptx`**, and LibreOffice here is Calc only (Writer/Impress were
deliberately not installed — see F2a). Writing a skill telling the model
how to create a `.docx` or `.pptx`, or build a new `.pdf`, through
`execute_code` would describe a capability that does not exist — the
exact anti-pattern F4 already named a reason NOT to build `suggest_research`.
`file-reading`'s own SKILL.md says this plainly rather than staying
silent about it. Adding these three packages is a real, boundable future
option (same "fixed, reviewed allowlist" pattern the Dockerfile's own
comment already establishes for pdfplumber/openpyxl/pandas) — not
attempted here because no measured case named a real need for it yet,
matching the discipline this project has applied every other time a
package or capability was added to that image.

### F2d — Cloud Run IAM invoker auth was attempted, deployed correctly, and still 401s for an unresolved reason — parked, not solved

**Status: real code exists** (`sandboxExecutionService.js`'s
`buildAuthHeaders`/`getIdTokenClient`, `config.sandboxServiceIamAuth`,
the `SANDBOX_SERVICE_IAM_AUTH`/`SANDBOX_INVOKER_KEY_PATH`/
`SANDBOX_SERVICE_CREDENTIALS_PATH` wiring in `.env.example`/
`docker-compose.yml`/`config.js`) **but nothing in production actually
uses it.** `SANDBOX_SERVICE_IAM_AUTH=false` in the real `.env`.

What happened, in order: the owner deployed a **second, differently-named**
Cloud Run service (`sandbox-service`, not `arcnave-sandbox-service`) with
`--no-allow-unauthenticated`, 2 vCPU/2Gi/240s, and a dedicated
`sandbox-invoker@...` runtime-invoker service account — correctly, per the
design this thread's own code already anticipated. Service-account key
creation (the path `SANDBOX_INVOKER_KEY_PATH` assumes) is blocked outright
by an org policy (`constraints/iam.disableServiceAccountKeyCreation`,
confirmed via `gcloud iam service-accounts keys create` failing with
`FAILED_PRECONDITION`) — so the code's key-file design **cannot work in
this GCP org as written**, key creation being disabled is itself normal
security hygiene, not a bug to route around.

The documented Google-recommended alternative — grant
`roles/iam.serviceAccountTokenCreator` and impersonate to mint a
short-lived ID token — was tried instead, correctly: the project-level
grant succeeded, `gcloud auth print-identity-token
--impersonate-service-account=... --audiences=<service URL>` succeeded
(valid token, correct `aud`/`sub`/expiry, confirmed by decoding the JWT),
and the exact `sandbox-invoker` binding was confirmed present on the
service via `gcloud run services get-iam-policy` (no condition, clean).
**Every one of those calls still got a 401 straight from Google
Frontend** — 2ms latency, empty body, never reaching the container.

Ruled out, one at a time, all read-only/diagnostic:
- Audience-URL form (vanity `.a.run.app` vs `PROJECT_NUMBER-REGION.run.app`)
  — tried both, same result.
- IAM propagation delay — waited and retried repeatedly over several
  minutes.
- **Google's own `gcloud run services proxy` tool**, using the owner's
  personal account directly granted `run.invoker` on the service (not
  impersonation at all) — same 401. This is the strongest single data
  point: it rules out anything about manually-constructed headers or
  this specific curl invocation.
- VPC Service Controls — `accesscontextmanager.googleapis.com` had never
  been enabled on the project; no perimeter can exist.
- Domain-restricted sharing / ingress org policies
  (`iam.allowedPolicyMemberDomains`, `run.allowedIngress`) — both
  `effective` policy is `allowAll: true`.
- Even re-granting `roles/run.invoker` to `allUsers` on that same service
  (making it nominally as public as `arcnave-sandbox-service` already is)
  **still 401'd** — meaning whatever is wrong is not scoped to the
  identity-token path specifically.

The one confirmed structural difference against the working service
(`arcnave-sandbox-service`, diffed field-by-field via `gcloud run
services describe --format=yaml`): a different `serviceAccountName`
(`sandbox-runtime@...` vs the default compute SA) and **no VPC connector
at all** (`run.googleapis.com/network-interfaces`/`vpc-access-egress`
absent — this second service was accidentally deployed without ADL-059's
own network-isolation property). Neither was confirmed as the actual
cause before time ran out on this pass; both are candidates for whoever
picks this up next.

**Resolution taken this session, not a fix:** abandon the second service
entirely (`gcloud run services delete sandbox-service`, done, owner
confirmed) rather than keep debugging against a possibly
double-broken target. F2's real verification instead updated the
original, already-working `arcnave-sandbox-service` in place with the
new image and resources, keeping its existing public ingress + shared
secret (no IAM layer) — see F2 above. **IAM invoker auth as a second
layer in front of the shared secret remains a real, open, unsolved
problem** — not abandoned as an idea, just not diagnosable further
without either GCP Support or someone with Console-level access to the
org's Identity Platform / Cloud Run internals. Do not re-attempt the
exact same impersonation-token approach without reading this section
first; it has already been tried correctly and failed for a reason still
unknown.

**Housekeeping note, same discipline as the prior secret-exposure entry
in `CURRENT-STATE.md`:** a real, short-lived (1-hour) impersonated ID
token was pasted directly into chat twice during this diagnosis before
the file-redirect pattern (`... | Out-File ...`, then read via the
assistant's file-read tool instead of the terminal) was adopted for the
rest of the session. Narrowly scoped (single Cloud Run service audience,
no broader Google API access) and already expired by the time this was
written — not treated as an outstanding credential risk, but the
discipline going forward is the same as before: redirect tokens/secrets
to a file, never paste them into a chat transcript.

## F3 — pdfplumber may make ADL-058 unnecessary, and that has not been measured

**Status: a genuine architecture question, deliberately left open.**

This is the most consequential flag in the file.

ADL-055→058 has spent six slices building deterministic table extraction
in JavaScript inside the backend. ADL-058 records exactly where it stops:
y-bucketing recovers the exam-fees PDF's identity columns 23/23 but
**misattributes the numeric columns**, because correct attribution needs
x-column-boundary detection that was done by hand, not automatically.

`pdfplumber.extract_tables()` does that detection. It is also what
produced this project's own independent ground truth for the ledger
statement (1020 rows, 49 pages, PLB ₹1,70,722.00 / SD ₹3,14,676.15) —
the figures
[`ai-chat-ledger-statement-category-month-approved-spec.md`](../60-product-reasoning/ai-chat-ledger-statement-category-month-approved-spec.md)
already cites as ground truth came from this pipeline.

So before ADL-058 is built, one measurement should settle it: run both
against the exam-fees PDF and compare column attribution. Possible
outcomes are genuinely different — pdfplumber wins and ADL-058's slice
is never needed; ADL-058 wins on trust because it runs in-process and
reviewed; or they are complementary (deterministic in-backend for the
common case, sandbox for merged cells).

**Do not build ADL-058 without running this first.** It is a slice that
might not need to exist.

A second, unresolved question rides on it: what trust level does sandbox
output carry? ADL-058's records are partial trust. Sandbox output can be
*verified* (the way `recalc.py` verifies a workbook), which may justify
more — but that is a claim, not a measurement.

## F3a — ✅ CLOSED 2026-08-26 — the sandbox now returns a FILE, verified before it leaves

**Was:** the sandbox could build a file and could only ever discard it —
`executeCode` returned `{stdout, stderr, exitCode}`, text only, and the
work directory was wiped before anything else could touch it.

**Now:** `sandbox-service/server.js` accepts an `outputFile` name, reads
it back from the work directory before the `finally` cleanup, and — for
`.xlsx` — runs `scripts/recalc.py` on it first. That script re-opens the
LibreOffice-recalculated workbook and checks it for three DISTINCT
failure modes, not just "did LibreOffice exit 0": error values
(`#REF!`, `#DIV/0!`, etc.), a declared formula cell that turned out to
hold a literal constant instead (the case that distinguishes this from
a naive gate — the workbook's numbers can all be correct and it still
fails), and a formula cell LibreOffice never actually evaluated. An
undeclared workbook (no `expectFormulasIn`) is reported `unverified`,
never `passed` — there is no way to skip the check.

`sandboxExecutionService.js` passes `outputFile`/`expectFormulasIn`
through and returns `files`/`verification`. `execute_code` gained the
same two params (as `saveAs`); a passed verification creates a new
Artifact holding the code and the verification report, then attaches
the workbook via the new `artifactService.attachGeneratedFile` — which
enforces the gate a SECOND time at the ownership boundary (refuses
unless handed the full report object, not a boolean, so no future
caller can bypass it by passing `{passed: true}`). A failed or
unverified result is reported back to the model with the exact reason;
its bytes never reach the model or the user.

New migration `1763600000000_artifact-generated-file.js` adds
`generated_document_id`/`generation_verified` — deliberately SEPARATE
columns from `published_document_id`/`published_at`, because publish is
terminal and a generated file should stay re-runnable, and because the
two paths produce fundamentally different content (an artifact's own
markdown vs. sandbox-produced bytes the artifact's text never held).

Verified end to end against the real running Docker image (not just
unit tests): all three failure modes plus the pass case were exercised
through actual LibreOffice recalculation via curl/node against a live
container — see `sandbox-service/scripts/test_recalc.py`, 11/11,
skips its own LibreOffice-requiring half gracefully outside the image.
Backend-side: 25/25 in `sandbox-execution-service.test.js`, 27/27 in
`artifact-service.test.js` (7 new for `attachGeneratedFile`), 14/14 in
the new `skill-service.test.js`.

**Still unresolved, carried forward as new flags below:** the image is
substantially bigger and none of its timing is measured (F2a), a single
`/ai/ask` turn can now take up to 210s for a file-generating call and
nothing solves that transport problem (F2b), three of the six
originally-planned skills could not be honestly written because the
sandbox lacks the packages to back them (F2c), and this whole path has
never been exercised against a real Gemini turn (F12, unchanged).

## F13 — live-checked (2026-08-26): the tool-select "deciding" phase is intermittently near or over its 45s budget with the larger tool list

**Status: real, observed, token cost now quantified — the timeout risk itself is still open.**

Live-tested against the real backend (`docker compose up app`, real Gemini/Vertex, `demo` college, principal login) in Curriculum mode, where the tool registry is actually visible to the model — the first test (Research mode) confirmed that mode has no live tool access at all and answers from general knowledge only, which is expected, not a bug.

Across roughly 5 Curriculum-mode turns:
- 2 timed out at the `"deciding"` phase specifically, with
  `Gemini (Vertex AI) request exceeded its overall time budget before a
  response was received"` — the hardcoded `MAX_TOTAL_STREAM_MS = 45000`
  in `gemini.js`.
- 1 succeeded at 42,878ms — 95% of that same 45s budget.
- The rest succeeded well under budget (6-22s).

This is the same class of transient Vertex timeout the ADR-030 P3
session already recorded once (`e3`, "not quota, not a content
failure"). But that was a single isolated occurrence in a clean run: a
`~40%` near/over-budget rate across a handful of live Curriculum turns
today, immediately after 21 new tools with often-long descriptions were
added to the registry (now 106 tools total, up from 85), is a real
correlation worth taking seriously rather than re-explaining away as
the same one-off.

**Now measured** (2026-08-26), with the same
[`token-cost-probe.js`](../../backend/scripts/token-cost-probe.js) used
for F9, against the real Vertex `countTokens` endpoint, role=`principal`:

| | Tools | Tokens |
|---|---|---|
| Before (HEAD, pre-session) | 79 | 10,741 |
| After (working tree, this session) | 100 | 12,786 |
| **Delta** | +21 | **+2,045 tok (+19.0%)** |

("79"/"100" here are the `principal`-role-filtered subset of the 85/106
totals stated elsewhere in this file — `class_send_alert`,
`finance_record_payment`, etc. aren't offered to `principal` at all,
same `allowedRoles` filter `askAgent` itself applies.)

**This does not, by itself, explain the F13 timeout.** +2,045 tokens on
a ~10-13K-token declarations block is real but not dramatic — Vertex
models comfortably handle far larger contexts than this in well under
45s under normal conditions. It rules out one easy story ("the tool
list alone tripled and that's why it's slow") without ruling out the
combination of a bigger declarations block *and* whatever intermittent
Vertex-side latency ADR-030 P3's own `e3` finding already named
("not quota, not a content failure"). The underlying timeout risk this
flag exists to track is **still open** — this measurement closes the
"is it unmeasured" half of the flag, not the "is it fixed" half.

## F14 — ✅ CLOSED (tool-specific fix) 2026-08-26: a `present_diagram` rejection crashed the whole turn instead of being reported back to the model

**Status: fixed and live-reproduced fixed. The general ADL-056 gap this is one symptom of remains open — see below.**

Asked for a flowchart live. The `deciding` phase (42.9s, see F13)
correctly selected `present_diagram`
(`{"phase":"running_tool","toolName":"present_diagram","stepIndex":0,"totalSteps":1}`).
The model's SVG used a gradient fill (`fill="url(#gradient1)")`) —
`aiDiagramService.buildDiagram`'s allowlist correctly rejects
`url(...)` even inside an otherwise-allowed attribute (it is a real CSS/
SVG injection vector, and the rejection itself is working exactly as
designed and tested in `ai-presentation-tools-batch2.test.js`).

**What is NOT working as intended:** that rejection is a **thrown**
`AiDiagramValidationError`, and nothing in the tool-use loop catches it
— it surfaced to the user as a bare "Sorry, I ran into a problem
answering that", with no chance for the model to see the reason and
retry without the gradient. `execute_code`'s sandbox failure (F2, same
session) degraded far more gracefully in the SAME live test, because
that failure is a normal RETURN VALUE (stderr text) the model reads and
explains — never a thrown exception.

This is not a new class of bug. It is
[ADL-056](../30-decisions/ledger.md#adl-056)'s own already-documented,
already-out-of-scope structural gap — **75 tools (now 106), 70+
validation-error classes, none caught in the general tool-use loop,
`aiService.js:2215`'s bare `await`** — now confirmed live against one of
this session's own new tools for the first time. `describe_diagram_constraints`
exists precisely so the model can avoid this by asking first; it did not
call it before drawing.

**Fixed via option 2 (the narrower, tool-specific mitigation) — option 1
(a general catch in the tool-use loop for all 70+ validation-error
classes) is still ADL-056's own explicitly out-of-scope FUTURE item,
untouched here.** `present_diagram`'s handler now catches
`AiDiagramValidationError` specifically and returns
`{rejected: true, reason}` instead of letting it throw — same shape
`execute_code`'s handler already used for a sandbox failure. Every other
tool in the registry is unaffected; this catch is scoped to one error
class on one tool.

**Live-reproduced fixed, same day, same prompt family.** Asked again —
this time explicitly requesting a gradient fill to force the same
rejection — and the turn completed cleanly in 19.3s. The model read the
structured rejection, correctly explained which SVG features are
forbidden and why (`url(#...)` IDs, `href`, external references), stated
what IS allowed (solid inlined `fill`/`stroke`), and offered to redraw
with a compliant version — a materially better outcome than the fix's
own minimum bar ("give the model a chance to retry"): it explained the
constraint back to the user unprompted.

Unit-tested in `ai-presentation-tools-batch2.test.js`
("present_diagram tool handler (F14: ...)", 4 tests): the exact live
gradient-fill case, a script-carrying SVG, an unaffected valid diagram,
and confirmation the catch is scoped to `AiDiagramValidationError` only
(an unrelated error still propagates).

**Still open, unchanged:** the general ADL-056 gap this is one symptom
of. 69+ other validation-error classes across the other 105 tools still
end a turn as an uncaught throw rather than a tool result the model can
react to. This fix does not touch that — it is scoped to exactly the one
tool this live test happened to hit.

## F4 — `suggest_research` was NOT built, on purpose

**Status: deliberately not built; needs an owner decision.**

`ai-copilot-research-mode-usage-imagegen-approved-spec.md` exists, but
grepping `src/` for `researchMode`/`research_mode` returns **nothing** —
research mode has an approved spec and no implementation.

A `suggest_research` tool would therefore offer the user a capability
ARCNAVE cannot deliver. That is the precise failure mode this whole
thread has been removing (a model promising what the system cannot do),
so it was left unbuilt rather than shipped as a broken promise.

Two ways forward, both the owner's call: implement research mode first,
or drop the tool.

## F5 — `fetch_sports_data` and `places_search` were not built

**Status: owner-decision, unchanged from the classification pass.**

Neither has a provider and neither has a stated campus need.
`present_places` and `present_map` (the *display* halves) were built and
work on caller-supplied data, so the presentation path exists if a
lookup source is ever named.

Per the standing rule, these are recorded as undecided, not rejected.

## F6 — a real bug was found and fixed; the class of bug is worth remembering

**Status: fixed. Recorded because the pattern will recur.**

[`aiDiagramService.js`](../../backend/src/services/aiDiagramService.js)
originally held its tokenizer regexes at module scope with the `/g` flag.
Every rejection is a `throw` out of the middle of an `exec` loop, which
leaves `lastIndex` mid-string — so the **next** diagram was scanned from
an arbitrary offset and its opening tags were never inspected.

That is a validator that silently stops validating after its first
rejection. It was caught only because the test suite rejects several
payloads in sequence; a single-case test would have passed.

Fixed by constructing both patterns per call. **Any future stateful
validator built the same way has the same defect.**

## F7 — the output-format policy is a tool, not prompt text, and that is a real limitation

**Status: deliberate, with a known cost.**

The natural implementation of
[`aiOutputFormatService.js`](../../backend/src/services/aiOutputFormatService.js)
is a paragraph in the system instruction. That is specifically what
[ADL-050](../30-decisions/ledger.md#adl-050) measured and rejected:
changing how that same governance-bearing instruction is packaged
measurably weakened a hard governance rule's compliance (category E,
3/3 → 2/7 live).

The cost of the tool form is real: **the model must choose to call it.**
Nothing makes it. At `maxToolCallsPerTurn = 1`, calling it also spends
the turn's only tool call, so it competes directly with actually
answering.

This ties into item 3 (`maxToolCallsPerTurn` above 1), which already has
the strongest evidence in the project behind it — the ADL-057 open-risk
check found the only recorded case of a tool-loop continuation
correcting a real failure. `decide_output_format` is a second
capability that is close to useless at cap 1.

## F8 — ✅ CLOSED (superseded) 2026-08-26 — the skills subsystem was built in the second pass

**Was:** the three questions below were open and this flag said the
subsystem needed its own Product Reasoning pass before any build.

**Now:** the product owner answered all three directly (not a Product
Reasoning pass — a direct decision), and the subsystem was built the
same day. See F3a for the implementation; recorded here only so the
three original questions have their answers on record in one place:

1. Where do skill bundles live, who owns them? **Files shipped with this
   codebase** (`backend/src/skills/*/SKILL.md`), reviewed like any other
   code change. No database row, no new owner service beyond the thin
   `skillService.js` reader.
2. Are skills per-tenant? **No — platform-owned only.** No per-college
   authoring, no RLS, no approval UI.
3. What executes them? **Nothing executes a SKILL.md itself** — it is
   instructions, and the model writes its own `execute_code` against
   them. The one exception, `recalc.py`, ships as a **quality gate**,
   not as skill runtime.

`capability_search`/`capability_explain` (built earlier, same day) cover
the five catalog tools' real user need without a marketplace and remain
a separate, non-overlapping piece of work — not a substitute for this,
and this is not a substitute for those.

## F9 — ✅ CLOSED 2026-08-26 — `conversation_read`'s guard measured against a real Vertex countTokens call

**Was:** the guard (return only `role`/`content`/`createdAt`, drop
`rawData`/`presentation`) was reasoned but never measured.

**Now:** measured with [`backend/scripts/token-cost-probe.js`](../../backend/scripts/token-cost-probe.js)
against the real Vertex AI `countTokens` endpoint — same technique and
model ADL-055's own 11,514/1,423/2,176/424-tok measurement used, run
live against this dev DB's own largest local conversation (14 messages,
conversation `161a8cb7`, college `demo`):

| | Tokens |
|---|---|
| Unguarded (`role`+`content`+`presentation`+`rawData`+`createdAt`) | 37,263 |
| Guarded (`role`+`content`+`createdAt` only — actual tool output) | 8,366 |
| **Guard saves** | **28,897 tok (77.5%)** |

This dev DB has no conversation carrying an ADL-055-scale document
extraction (the 125,048-token case was measured against real
ledger-PDF content that isn't present here — see F3), so this is a
real but modest-case number, not the worst case. The worst case is
already bounded by construction, not by this measurement: the guard
drops exactly the two fields (`rawData`/`presentation`) that carried
that cost, regardless of how large either gets — a 500KB extraction
and a 5KB one are guarded the same way. Even at this modest scale the
saving is 77.5%, which is consistent with the guard doing real,
substantial work rather than reasoned-but-negligible.

## F10 — ✅ CLOSED 2026-08-26 — `ai-capability-matrix.md` regenerated from source

**Was:** documented 66 tools against a live registry of 104 (106 by the
time this closed), stale before this pass and made worse by it.

**Now:** regenerated directly from `aiToolRegistry.js` (`grep -c
'registerTool({'` = 106, plus a per-call-site
`name`/`level`/`dataClassification`/`allowedRoles` extraction — not
inferred). §§4.1–4.9 (the 2026-08-21 baseline, 66 tools) are unchanged;
new §§4.10–4.16 document the 40 tools that were missing (memory,
session/conversation, presentation widgets, output-format/skills
policy, capability catalog, code execution, search, artifact-lifecycle
additions), each with its real registered level/classification/roles
and, where relevant, a pointer to the flag in this file that still
applies to it (F1, F2, F3, F3a, F7, F9, F14). §8's conformance table
notes plainly that these 40 tools carry **no dedicated `RS-AIG` rule**
— governed only by the general umbrella rules — which is a real
specification-layer gap this regeneration surfaces rather than papers
over.

`bka/tools/validate.py` confirms no new broken cross-references from
this edit (28 remaining errors are all pre-existing ADL-056/057/058
undefined-ledger-entry issues, already present across multiple other
files before this pass).

It is still a manual doc, not CI-enforced — nothing stops it drifting
again the next time tools are added. That risk is accepted, not solved.

## F11 — ✅ CLOSED 2026-08-26 — the `backend/`/`sandbox-service/` work is committed

**Was:** this thread's entire backend implementation (skills subsystem,
xlsx verification gate, 21 new tools, F14 fix, matrix regeneration,
token probes) was uncommitted.

**Now:** committed, with explicit permission asked and given first —
`git commit` `e700004`, "Add skills subsystem, verified xlsx generation,
and 21 new AI tools", 38 files, +5653/-96. Scoped deliberately to this
thread only — the untracked probe scripts and spec doc belonging to the
separate, unrelated ADL-055→058 document-analysis thread
(`corpus-anomaly-probe.js`, `statement-*.js`, `csv-fallback-probe.js`,
`universal-extraction-probe.js`,
`ai-chat-ledger-statement-category-month-approved-spec.md`) were left
untouched, per "do not merge or reconcile" in `CURRENT-STATE.md`'s own
two-thread note. A stray `sandbox-service/scripts/__pycache__/*.pyc`
was caught before staging and excluded; `.gitignore` gained
`__pycache__/`/`*.pyc` so it can't recur.

## F11a — the full suite's failure count is not stable across runs

**Status: re-confirmed 2026-08-26, still uninvestigated, still unrelated to this pass.**

Four consecutive `docker compose run --rm app npm test` runs on
identical code reported `# fail` as **5, 6, 2, 2**. The named failures
(`not ok` lines) were the same two pre-existing
`fetch_trusted_web_page` role assertions every time a run was grepped
for them — so the leaf failures are stable and the *count* is not.

A `position_department_assignments_department_id_fkey` foreign-key
violation appears in the log output of the higher-count runs, from
`positionAccountInvitationService.ensureHodPositionForInvite`
(`backend/src/services/positionAccountInvitationService.js:190`) —
a check-then-act pattern (`findActiveDepartmentAssignment` then
`createPositionDepartmentAssignment`, not one transaction/constraint)
that would produce exactly this FK-violation shape if two test files
touching the same department row run concurrently under Node's
default parallel test-file scheduling. Plausible, not confirmed.

**Re-run 2026-08-26 while redeploying the sandbox (F2):** the 4 test
files that exercise this code path
(`class-tutor-position-provisioning.test.js`,
`identity-resolvers.test.js`, `position-schema.test.js`,
`staff-lifecycle-service.test.js`) run together cleanly, 55/55 — no
repro in isolation. Two full-suite runs via `docker compose exec app
npm test` both came back clean at the stable **2/2** (same two
pre-existing failures, nothing else); a third attempt hit an unrelated
classifier permission block before it could run, not a test failure.
So: the instability is real (reproduced earlier this session at 3 fail
with a different 3rd test each time) but remains non-reproducible on
demand — most runs are clean, a minority aren't. Still points at shared
DB state between concurrent test files rather than at this session's
own changes.

Recorded because an unstable failure count makes "zero regressions"
harder to assert for everyone downstream, not because it blocks
anything here. Full root-cause (the exact colliding test-file pair,
if that's really the mechanism) still needs its own investigation
pass — out of scope for a mechanical flag-clearing pass.

## F15 — PARTIALLY FIXED 2026-08-26: budget-exemption shipped and live-verified; the underlying two-tool-sequence gap is still open

**Status: real, half-fixed. The reachability bug is gone; the capability gap it was hiding is not.**

**Original finding**, via `backend/scripts/f12-live-tool-probe.js`, real
Gemini, real 400-page/1603-record result-sheet PDF attached: asked
*"Can you give me an Excel file breaking down the arrears in the ECE
Sandwich section, with a formula-based total?"*

The model called `list_skills`, read that `xlsx` skill guidance exists,
and then answered: *"The retrieved data only lists available code
skills... and does not contain any student or arrear records... If you
have the relevant sheet or records, please share..."* — despite the
exact document being attached to the same turn. At
`maxToolCallsPerTurn = 1`, `list_skills` alone spent the turn's only
tool call, so nothing else could run.

This is the concrete case [F7](#f7-the-output-format-policy-is-a-tool-not-prompt-text-and-that-is-a-real-limitation)'s
"cap 1 competes with actually answering" concern and item 3
(`maxToolCallsPerTurn` above 1, [ADL-057 open-risk
check](../30-decisions/ledger.md#adl-057-open-risk-check--the-model-cannot-write-a-usable-identitypattern-at-cap-1-2026-08-26))
both already named in the abstract, now reproduced concretely against
this session's own new file-generation capability.

**Fix 1, shipped — `BUDGET_EXEMPT_LOOKUP_TOOLS`** (`aiService.js`,
`askAgent`'s tool-use loop). `list_skills`, `describe_skill`,
`decide_output_format`, `decide_image_route`,
`describe_diagram_constraints`, and `capability_search` no longer
consume `config.maxToolCallsPerTurn` — the same exemption
`describe_tools` already had (that tool's own comment predicted exactly
this failure: *"a fetch that ate the turn's only tool call would leave
the model unable to call the very tool it just looked up, and the
feature would be worse than useless"* — the skills subsystem and
output-format tools shipped without it). `capability_explain` is
deliberately NOT exempt — it reads real per-college configuration
through a Business Service, so it is a data read, not a pure lookup.
They still run through the Policy Gate, still audit, still count in
`toolsUsed`, still anchor nothing (a new `primaryTool` picks the first
NON-exempt invoked tool for presentation/verification, falling back to
the first tool only if every call in the turn was a lookup). A separate
`MAX_LOOKUP_CALLS = 3` backstop, checked before the handler runs (not a
post-hoc counter reset, which would let the model loop in unlimited
batches), stops an unbounded lookup loop from burning latency the
budget exemption no longer bounds.

5 new tests in `ai-service.test.js` pin: the exemption lets a real tool
still run at cap 1; a lookup is still reported in `toolsUsed`; the
`primaryTool`/anchor fix; the `MAX_LOOKUP_CALLS` backstop is a plain
refusal, not a throw; and a NON-exempt tool still consumes the budget
(the exemption is an allowlist, not a general softening). Full suite:
2388/2390 (same 2 pre-existing failures, zero regressions).

**Fix 1 verified live** (`backend/scripts/f15-cap2-live-retest.js`, cap
temporarily raised to 2 for OBSERVATION ONLY — `config.js`'s own
default stays 1, that decision needs its own pass, not a side effect of
this one): first attempt hit the F13 timeout (a 4th live occurrence —
see F13); second attempt completed with
`toolsUsed: ["list_skills","describe_skill","execute_code","execute_code"]`
— proof the exemption works exactly as designed: two lookups ran for
free, then TWO real budgeted calls (the cap-2 ceiling) both went to
`execute_code`.

**Still open, a different and more specific gap than originally
scoped:** the final answer was *"The arrears breakdown... hasn't been
generated yet... would you like me to process that PDF and generate the
Excel workbook"* — no file was produced even with two `execute_code`
attempts and the budget no longer blocked by a lookup. The model never
called `analyze_document_table` at all in this run. Per
`file-reading/SKILL.md`, `execute_code` genuinely CAN read an
attachment directly via its `attachmentId` (an earlier draft of this
entry claimed it could not — that was wrong, corrected here) — so the
model may have attempted to parse the 400-page PDF ad hoc inside the
sandbox rather than reaching for the already-deterministic
`analyze_document_table` path, and failed at that twice. This script
only logged tool NAMES, not each call's arguments/stdout/stderr, so the
exact reason the two `execute_code` calls didn't produce a file is
**not captured** — recorded honestly as unknown rather than guessed at.

**Next step, not attempted here:** re-run with per-call argument/result
logging (the wrapping pattern `identity-pattern-live-turn.js` already
uses on `documentAnalysisService.analyzeAttachment`) to see what the
model actually sent to `execute_code`, and consider whether
`file-reading/SKILL.md` should say plainly "if a domain-specific
extraction tool exists for this data (`analyze_document_table`), call
that first and pass its result into your script — do not re-parse a
large document from scratch inside the sandbox."

## F16 — live-checked (2026-08-26): `present_diagram` is still never actually chosen for a natural "show me a diagram" request

**Status: real, observed — a discoverability gap, distinct from F14.**

Same live session, same attached PDF: asked *"Show me a diagram
summarizing the arrears situation in the ECE Sandwich section."* The
model called `analyze_document_table` (already well-exercised) and
then **hand-rendered its own ASCII/unicode bar chart directly in the
answer text** — register-number-keyed rows with a run of `■` characters
per arrears count — rather than calling `present_diagram` (or even
`present_options`/a chart-shaped presentation tool) with the same data.

F14's live reproduction of `present_diagram` (the gradient-fill
rejection) came from a *different* prompt that asked for a flowchart
specifically; this is the first time "show me a diagram" was asked
against real tabular data, and the model didn't reach for the
presentation tool at all despite it being registered, permitted, and
its constraints self-describable via `describe_diagram_constraints`.
Consistent with the ADL-057 precedent this file already cites
repeatedly: a tool passing every unit test is not the same as a tool
the model discovers and uses unprompted. Needs its own investigation
(tool description wording, retrieval catalogue placement, or accepting
that "diagram" in a user's own words doesn't obviously map to an SVG
tool) — not attempted here.

## F13 — third live reproduction (2026-08-26): a plain, attachment-free capability question also timed out

**Status: strengthens F13 above — the risk is not attachment/document-processing-specific.**

Same live session: *"What can you help me with when it comes to
student marks and attendance? List your real capabilities."* — no
attachment at all, a question shaped for `capability_search`/
`capability_explain` — **threw `Gemini (Vertex AI) request exceeded
its overall time budget before a response was received`** during the
`deciding` phase, the same failure mode F13 already recorded twice
against document-heavy Curriculum turns. A third occurrence, this time
with no document context at all, is evidence against "it's attachment
processing that's slow" and for "the tool-select decision itself,
independent of the question's content, is intermittently too slow with
106 tools registered" — consistent with, though not proven by, the
+19.0% token-cost delta F13 already measured.

**Fourth occurrence (2026-08-26, F15 cap-2 live retest):** the FIRST
attempt at `backend/scripts/f15-cap2-live-retest.js` — an
attachment-heavy turn this time, the exact opposite content shape from
the third occurrence above — hit the identical timeout on its first
try; a second attempt (same question, same document, same process)
completed normally. Now 2 timeouts on document-heavy turns, 1 on a
plain text-only turn, all followed by a clean run on retry — the
pattern looks like a genuine intermittent Vertex-side latency floor
independent of question shape, not a specific trigger this project has
found yet. Still unmitigated; still worth designing around (raising
`MAX_TOTAL_STREAM_MS`, a client-side retry-once, or reducing the
tool-select payload) before this is relied on for anything time-sensitive.

## F12 — ~~nothing in this pass has been run against a live model~~ — PARTIALLY CLOSED 2026-08-26

**Status: a real live pass happened. It found exactly the two things this flag predicted, plus one it didn't.**

A short live session against the real backend (real Gemini/Vertex,
`demo` college) confirmed the concern this flag raised was not
theoretical:

- `execute_code` was genuinely selected and called with real params by
  the model, and gracefully reported a real, expected failure
  (F2 — the deployed sandbox still lacks the packages). No artifact was
  created, matching the gate's design.
- `present_diagram` was genuinely selected, and the model's own SVG
  failed the allowlist on its first attempt (a gradient fill) — this
  flag's own prediction ("most sharply for `present_diagram`") came
  true on the very first live attempt. See **F14** for what that
  rejection actually does to the turn — a NEW, more specific finding
  this pass surfaced, not one this flag anticipated.
- A third finding this flag did not anticipate at all: the tool-select
  `"deciding"` phase itself is now intermittently near or over its 45s
  budget. See **F13**.

**Update 2026-08-26, second live session (`backend/scripts/f12-live-tool-probe.js`,
same real result-sheet PDF, 3 more turns):** `list_skills` and
`analyze_document_table` (already-tested) were genuinely selected —
see **F15** (the model read `list_skills`'s output but didn't connect
it to the ALREADY-ATTACHED document, so the requested Excel file was
never built) and **F16** (`present_diagram` still wasn't chosen for a
direct "show me a diagram" ask — the model hand-rendered its own ASCII
chart via `analyze_document_table` instead). A third **F13** timeout
also occurred, this time on a plain attachment-free capability
question — see that flag's own updated entry.

**Still open:** 5 of the 21 new tools now exercised at least once
(`execute_code`, `present_diagram`, `list_skills`, plus
`analyze_document_table`/`capability_search`-shaped questions that
either succeeded via a different tool or timed out before selection).
16 remain untested: every other `present_*` tool
(`present_featured`/`present_comparison`/`present_carousel`/
`present_links`/`present_places`/`present_map`/`present_recipe`),
`describe_diagram_constraints`, `capability_explain`, `describe_skill`,
`conversation_*`, `ai_memory_revise`, `decide_output_format`/
`decide_image_route`, `web_search_fast`/`image_search` (blocked on F1
regardless). The ADL-057 precedent (a tool that passed every unit test
and that the model could not actually use because nothing told it what
a row looked like) remains a live risk for all of them — and F15/F16
are now concrete instances of exactly that risk, not just a prediction.

## F17 — no crisis/self-harm handling policy exists anywhere in ARCNAVE's AI governance

**Status: genuine gap, needs an owner decision on scope before any code — the most severe of the five flags below (F17-F21), by this file's own "damage if forgotten" ordering.**

Found 2026-08-27 while adapting an externally-supplied generic "AI
Assistant Operating Instructions" template against ARCNAVE's real
configuration. (That pass's own write-up was dropped 2026-08-28 when the
owner adopted the domain-neutral
[`ai-operating-instructions.md`](ai-operating-instructions.md) instead —
its findings are F17-F21 here, so nothing was lost.)
That template's Section 5.2 requires inverting normal caution during a
crisis: never deflect, provide resources unprompted, don't ask
distress-deepening clarifying questions. A search of
`RS-AIG-ai-governance.md`, `aiPromptSafetyLayer.js`, and every tool
description in `aiToolRegistry.js` for self-harm/crisis/suicide/distress
handling returned **nothing** — not a rejected design, an absent one.

ARCNAVE's users are principals/HODs/staff/class-tutors, not students
directly, in most flows — but a class-tutor describing a student in
distress, or a staff member themselves in crisis, typing into an AI
chat about attendance or marks is not implausible in an education
setting. No mechanism today does anything different with that input
than any other message.

**Not built here, on purpose:** whose crisis this should even cover
(a student described by a staff user, the acting staff user themselves,
or both), and what "provide resources" means for an Indian campus
context (a specific helpline number is itself a product/compliance
decision, not a technical one) are both **owner decisions**, per this
file's own standing rule — not something to assume and build
unilaterally.

## F18 — AI Memory has no defense against a stored behavioral instruction

**Status: small, bounded gap — not urgent, no recorded incident.**

Found in the same adaptation pass as F17. `ai_memory_remember_fact`
(`aiToolRegistry.js:2593-2619`) already refuses two content categories
structurally: a fact about anyone other than the acting user, and any
bare identifier number. Neither check would catch a user asking the AI
to remember something like "always agree with me" or "never push back
on my numbers" — phrased as a preference, this would currently be
accepted as a legitimate freeform fact. The generic template's own
reasoning for naming this as its own category (not just "off-topic
content"): a stored instruction like this would let a user permanently
degrade the AI's own honesty over time, one saved "preference" at a
time — a different failure mode than the third-party-fact or
identifier-number leaks the existing checks target.

**Possible fix, not attempted:** a keyword/pattern backstop in
`aiMemoryService.rememberFact` similar in spirit to the existing
identifier-number regex backstop, or a description-level instruction to
the model to decline such a request and explain why (weaker, per this
project's own repeated finding that prompt-only guidance under-performs
a deterministic check — see `CURRENT-STATE.md`'s "the rule these share,
demonstrated three times in one session").

## F19 — accumulated AI Memory facts are never re-validated for drift across sessions

**Status: unmeasured, no recorded incident, same shape as F18.**

`aiService.js`'s `decisionSegments` reuse guarantee (ADL-050) holds
governance-bearing system content byte-identical **within one turn's
tool-use loop** — a real, measured property. Nothing equivalent exists
**across turns or sessions** for AI Memory's own accumulating facts:
once a preference or freeform fact is remembered, it is carried forward
indefinitely with no mechanism checking whether a large accumulated set
has gradually reshaped the AI's behavior away from its own governance
rules (the generic template's Section 5.5 concern). `MAX_GENERAL_FACTS`
bounds the count, not the cumulative effect.

## F20 — no explicit "single instance, no sub-agents, here is exactly what you have" statement anywhere in ARCNAVE's system prompt

**Status: unmeasured risk — no audit row shows this actually happening.**

The tool-catalogue system segment (`aiService.js`'s `buildToolCatalogue`)
lists tool **names**, which is a structural, stronger version of "state
your capabilities" for tools specifically — but nothing tells the model
in prose that it is a single instance with no sub-agent hand-offs, or
gives it the equivalent of the generic template's Section 1 rule for
non-tool capabilities (e.g., "you have no image generation" is true only
by omission — no tool exists — not stated anywhere the model would see
it before being asked). Per [[measure-before-designing]], not worth
adding prompt text for a failure mode nothing has actually observed yet;
recorded so it is not silently forgotten if F12's ongoing live-testing
of untested tools (image_search included) ever surfaces one.

## F21 — no explicit cost-tiering rule between deterministic and expensive extraction paths

**Status: minor, foldable into ADL-058's own eventual build-slice, not a standalone pass.**

`analyze_document_table` (deterministic, cheap) versus geometric/native
PDF reconstruction (ADL-058, measured slower, still FUTURE/unbuilt) is
exactly the shape the generic template's Section 4.2 asks every
cost-sensitive skill to state explicitly: a default cheap option and a
named condition that triggers escalation. Today this is enforced only
by which tools exist at all (geometry isn't built yet), not by a stated
rule a tool description teaches the model to follow. When ADL-058 is
eventually built, its own tool description should state the tiering
explicitly rather than relying on the model to infer it — noted here so
that build-slice doesn't skip it.
