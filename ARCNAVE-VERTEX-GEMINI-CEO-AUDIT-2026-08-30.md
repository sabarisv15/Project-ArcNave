# ArcNave — Vertex AI / Gemini CEO Capability Audit

*Real codebase-grounded, not documentation-assumed. Every fact below was verified against actual files (cited inline) before any decision was made.*

---

## Part 1: Executive CEO Verdict

**ArcNave Vertex AI-ai evlo level-ku depend aaganum?**
Intelligence layer-a mattum. Operating-system-a agakoodadhu. ArcNave-oda business truth (attendance, marks, fees, student identity, workflow approval) eppodhume ArcNave-oda database + `WorkflowService`-la than irukkanum, Gemini-oda answer-la illa. Idhu already correct-a design pannirukanga (RS-AIG-001 to 018) — idha maathradhu vேண்டாm.

**Endha areas-la use pannalam?** Text/image/audio/document *padikkardhu*, tool-select pannradhu, extraction *draft* pannradhu, summarize pannradhu, search pannradhu — ellame "solradhu/paakradhu" velai, "mudivu edukkardhu" velai illa.

**Endha areas-la strict control venum?** Extraction results human verify pannாma record aagakoodadhu (already rule irukku). Function calling — ஒரே time-la ஒரு action mattum (already rule). Cost/quota — **இப்போ இல்லை, உடனே வேணும்** (naan kandupudichен, kelvi-e illama).

**Endha areas-la use panna koodathu?** Computer Use (browser control), Google-oda own code sandbox, fine-tuning, chain-of-thought exposing — ivai ellam risk-a irukku, ArcNave-ku real use-um illa.

**ArcNave own-a control panna vேண்டிya core areas enna?** Identity, permissions, workflow approval, audit trail, tenant isolation (database level), attendance/marks/fees records, document storage. Ivai edhுvும் "AI provider maathradhu" nu decide panna koodathu.

**BKA documents-la irukkura endha assumptions accept panna mudiyathu, why?** Naan investigate pannிதhu la **rெண்டு periya gap** kandupudichen, BKA documents specifically idha pேசale — idhu BKA "thappu" solradhu illa, BKA idha touch pannaவே illai:

1. **Cross-provider fallback zero-a irukku.** ArcNave-la 4 AI providers (Gemini/Claude/OpenAI/self-hosted) wire pannirukanga (RS-AIG-008 correct-a soludhu, "provider swappable"), aana Vertex/Gemini down aana, automatic-a vேறே provider-ku switch aagum mechanism **kidayathu**. Retry irukku (`retry.js` — 3 tries, same provider mattum). Idhu reliability principle #5-ஐ (fallback plan mandatory) namma own-a break panniruoam.
2. **AI cost/quota control zero-a irukku.** `ai_llm_call` nu audit log pannuroam, aana "இந்த college-ku idhu podhum" nu ஒரு limit vekradhu illa. Real customers vandha, ஒரு college over-use pannina, bill கட்டுப்பாடு இல்லாமல் போகும்.

Ivை rண்டையும் **P0** aa keezhe mark pannirukken — BKA-la "venaam" nu sollala, "இதுவரை touch pannalا" nu than sonnadhu, so idhu ஒரு real, urgent gap.

---

## Part 2: Complete Numbered Capability Register

| ID | Vertex/Gemini Native Capability | Simple Tanglish Meaning | ArcNave Current Status | Native Support? | Recommended Use | CEO Decision | Why Use | Why Avoid/Limit | Reliability Risk | Required Safeguard | Priority |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | Text Understanding | Plain text padichu answer sollradhu | ✅ Full-a irukku (`aiService.js`) | Yes | Use now | **Use internally** | Chat, summarize, classify — core AI velai | — | Low | Prompt safety layer already irukku | P0 (already done) |
| 2 | PDF/Document Native Reading | PDF-a nேrடி Gemini padikkardhu (image maadhiri) | ✅ Attempted, aana product decision-படி **default illa** — pdfplumber (deterministic) than use pannuroam, Gemini count/sum thappu solрадhu measure pannirukanga (ADL-058/063) | Yes | Use only as identity/attribution verifier, not for counting | **Use behind ArcNave abstraction** | Merged-cell attribution correct-a solрадhu | Counting-la weak, 400-page doc-la fail aagும் | High (silent wrong count) | Deterministic tool cross-check mandatory | P2 |
| 3 | Image Understanding | Photo/screenshot-a paathu puriyardhu | ✅ Full-a irukku, live-a wire pannirukanga | Yes | Use now | **Use internally, human-verify output** | ID card, form-la irundhu field extract pannradhukku strong | — | Medium (wrong field extract aagalam) | RS-AIG-012 verification gate already irukku | P0 (already done) |
| 4 | OCR — Tesseract (current, own) | Scan pannina document-la irundhu text edukkardhu (namma own engine) | ✅ Real-a build pannirukanga (`tesseractOcr.js`), admission-wizard field-extraction-la use aagudhu | N/A (not Gemini) | Keep as default | **ArcNave-owned, keep** | Free, offline, already tested | Handwriting-la weak | Medium | Confidence-low results-ku escalate pannanum | P1 |
| 5 | OCR — Gemini Native Vision (alternate) | Same OCR velai, aana Gemini vision use pannி | 🔴 Missing — namma Tesseract mattum use pannுroam everywhere | Yes | Use **only** when Tesseract confidence low (handwritten/messy scan) | **Integrate as optional escalation tier** | Handwritten ID card/form-la Tesseract fail aagும், Gemini better | Cost increase-la every doc-ku Gemini anuppுna | Medium | Escalate only, not default; verify gate stays | P1 |
| 6 | Handwritten Form Extraction | Kai-ezhuthu form-a padichu field edukkardhu | 🔴 Missing/weak — Tesseract handwriting-la kammi | Yes (Gemini vision) | Use Gemini vision, mandatory human verify | **Use with mandatory human approval** | Admission forms romba handwritten-a varum | Wrong field = wrong student record | High | RS-AIG-012 already mandatory, keep strict | P1 |
| 7 | Table/Spreadsheet AI Reading | Table-a AI padichu understand pannுradhu | 🟡 Attempted (native PDF/doc reading), aana **retired** for count/sum (ADL-065 — `analyze_document_table` removed) | Yes | Use only for description, never for count/sum | **Replace with ArcNave-owned logic** | — | AI count thappu (measured: 2 vs real 23) | Very High | Deterministic tool (`documentAggregateService`) mandatory for numbers | P0 (already correctly avoided) |
| 8 | Deterministic Table Extraction (own) | pdfplumber/library vachu exact-a table padikkardhu, AI illama | ✅ Build pannirukanga, verified 23/23 | N/A | Keep, expand | **ArcNave-owned, keep** | 100% accurate-a irukku already | — | Low | — | P0 (already done) |
| 9 | Audio Understanding | Audio file-a AI kேttu answer sollradhu | ✅ Live-verified (`audio/wav`) | Yes | Use now | **Use internally** | Voice note, meeting audio understand panna | Video-க்கு paralel-a irukku, unverified codecs | Medium | Per-attachment failure = honest degrade, already build pannirukanga | P1 |
| 10 | Video Understanding | Video file-a AI paathu understand pannுradhu | 🟡 Adapter-la attempt pannுm, aana codec-wise verify pannala | Yes | Use only when a real product feature needs it | **Defer — no feature exists yet** | — | ArcNave-la video-content feature-e illa (lecture recording etc.) | Low (no live use) | — | P3 |
| 11 | Speech-to-Text/Voice Notes | Pேச்சа text-a maatрадhu | ✅ Already implicit-a varudhu (audio path already irukku) | Yes | Use now, no new work | **Use internally** | — | — | Low | — | P2 |
| 12 | Structured Output/JSON Schema | AI answer-a fixed format-la (JSON) force pannுradhu | 🔴 Missing — namma prompt-la mattum "JSON kudu" nu kேttu vachurukanga, schema enforce pannala | Yes | Use for every extraction tool | **Use internally, mandatory** | Wrong-format data record aaganum-nu risk குறையும் | — | Currently High (no enforcement) | Post-generation validation mandatory | **P0 — build next** |
| 13 | Function Calling — Single | AI ஒரு tool-a select pannி call pannுradhu | ✅ Production-la irukku, 75+ tools | Yes | Use now | **Use internally** | Core AI action mechanism | — | Low | Policy Gate already irukku | P0 (already done) |
| 14 | Function Calling — Parallel | Onnukku mேl tool same time-la call pannுradhu | 🔴 Missing, **deliberate-a** venaam nu decide pannirukanga (RS-AIG-018) | Yes | Read-only, no-side-effect calls mattum future-la allow pannalam | **Conditional — accept for read-only only, reject for write** | Speed-a irukum read-only-ku | Write-order confusion risk-a irukku records-ku | High (if allowed for writes) | Never for L3/write actions | P3 |
| 15 | Multi-Step Agent Plan | AI plan pannі, 6 steps varaikkum sequential-a tools run pannுradhu | ✅ Build pannirukanga (bounded plan, RS-AIG-018) | Yes | Use now | **Use internally** | Complex velai-ku useful | — | Medium (managed by gate) | Every step same Policy Gate re-check aagும் | P0 (already done) |
| 16 | Web Search Grounding (public) | Internet-la search pannі real info kudுpрадhu | ✅ Already shipped (`web_search`) | Yes | Use now | **Use internally, optional per college** | Fresh public info venum sometimes | Hallucination-a irukalам | Medium | Untrusted-data boundary already irukku | P0 (already done) |
| 17 | URL Context Retrieval | ஒரு specific webpage-a padikkardhu | ✅ Already shipped (`web_fetch`) | Yes | Use now | **Use internally** | Trusted regulatory sites padikkardhukku | — | Low | Allowlist already irukku | P0 (already done) |
| 18 | Vertex AI Search Grounding (Private Data/Enterprise RAG) | Namma sondha documents-a Google-oda own system-la search pannuradhu, namma RAG build panna vேண்டாm | 🔴 Missing, aana namma sondha RAG (#19) already irukku, work pannுdhu | Yes | Do not adopt yet | **Defer — own decision needed, own-RAG vs managed-RAG comparison first** | Maintenance kammi aagalam | Tenant isolation verify pannaவேila; provider lock-in risk periya | High (architecture risk) | Own comparison pass mandatory before touching | **P0 to decide, not to build** |
| 19 | ArcNave-owned RAG (`search_documents`, pgvector) | Namma sondha document search system, database-lேye build pannirukom | ✅ Real-a work pannுdhu, cosine similarity, tenant-isolated (RLS) | N/A | Keep, expand | **ArcNave-owned, keep** | Already tested, already tenant-safe | — | Low | — | P0 (already done) |
| 20 | Embeddings (text) | Text-a number vector-a maatрадhu, search easy aaga | ✅ `gemini-embedding-001`, 1024 dims | Yes | Use now | **Use internally** | Search, tool-retrieval-ku base | Model maarina re-embed pananum | Medium | Provenance tracking already irukku | P0 (already done) |
| 21 | Spatial Grounding (bounding box/point) | Photo/PDF-la "இந்த spot-la than idhu irukku" nu kaatрадhu | 🔴 Missing | Yes | Use for extraction-verification UX | **Use internally, PDF/image only** | Human verify pannுmbodhu fast-a irukும் | Video use-case illai ippo | Low | Coordinates validate pannanum before render | **P1 — build (8C)** |
| 22 | Temporal Grounding (video/audio timestamp) | Audio/video-la "இந்த நேரத்துல idhu sonnanga" nu kaatрадhu | 🔴 Missing | Yes | — | **Defer** | — | ArcNave-la video/meeting-recording feature illa | Low | — | P3 |
| 23 | Computer Use (Preview) | AI browser/screen-a nேrடி control pannуradhu | 🔴 Missing | Yes (Preview) | Never | **Avoid completely** | — | Unstable, no product need, backend-touch risk periya | Very High | RS-AIG-018 already bars this | **Rejected** |
| 24 | Code Execution — Vertex/Gemini native | Google-oda own Python sandbox-la code run pannுradhu | 🔴 Missing | Yes | Never | **Avoid, replace with own logic** | — | Namma sondha sandbox already better (network-isolated) | Medium (redundant, weaker) | — | **Rejected** |
| 25 | Code Execution — ArcNave-owned sandbox | Namma sondha sandbox, database-ku path illama | ✅ Build pannirukanga (ADL-059) | N/A | Keep | **ArcNave-owned, keep** | Safe-a design pannirukanga already | — | Low | Already credential-less | P0 (already done) |
| 26 | Thinking Levels (low/medium/high) | AI evlo "deep-a yosikkanum" nu control pannуradhu | 🔴 Missing — ippo எப்போதும் same level (LOW) | Yes | Use per-task | **Use internally** | Simple velai fast-a, complex velai deep-a | — | Low | — | **P0 — build next (8B)** |
| 27 | Thinking Trace Visibility | AI-oda internal yosippு-a streaming-a kaatрадhu | 🔴 Missing | Yes (optional) | Never expose as proof | **Avoid — never user-facing as evidence** | — | Chain-of-thought fake-a irukkalам, misleading | High if misused | Governance rule already bars this | **Rejected as evidence** |
| 28 | System Instructions | AI-oda basic rule/behavior fix pannуradhu | ✅ Every call-lேyும் anuppுroam | Yes | Use now | **Use internally** | Prompt-injection-a resist pannрадhu | — | Low | Safety Layer already wraps | P0 (already done) |
| 29 | Safety Settings | Bad content (violence, hate) filter pannрадhu | 🟡 Default settings mattum use pannுroam, custom config illa | Yes | Keep default | **Use default, revisit only if issue varum** | — | — | Low | — | P2 |
| 30 | Stop Sequences | Specific word vandha AI-a udане niruthрадhu | 🔴 Missing | Yes | No real need | **Skip** | — | Namma prompt design-ku vேண்டியே illa | — | — | P3 |
| 31 | Temperature/Sampling | AI-oda "creativity" level control | 🟡 Not explicitly set (default use aagудhu) | Yes | Low temperature for extraction tasks | **Use internally, keep low for factual tasks** | Consistent answer venum campus data-ku | High temp = unpredictable | Medium | — | P2 |
| 32 | Max Output Tokens | Ore பதில்-la evlo periya answer varum | ✅ 65,536 verified | Yes | Keep as-is | **Use internally** | Large table output-ku venum | — | Low | — | P0 (already done) |
| 33 | Context Window Size | Ore prompt-la evlo periya data anuppலam | 🟡 1M claim irukku, ArcNave-la independently verify pannala | Yes | Confirm, don't over-rely | **Use with bounded chunking, verify limit before trusting** | — | Full document anuppрадhukku helpful | Cost periya aagும் periya context-ku | Medium | Preflight token count mandatory (#34) | P2 |
| 34 | Token Counting Preflight (`countTokens`) | Request anuppрадhukku munnadi "idhu evlo cost aagும்" nu check pannрадhu | 🔴 Missing in real pipeline (script-la mattum measure pannirukanga, adapter-la illa) | Yes | Use before every large request | **Use internally, mandatory for large attachments** | Cost/oversized-request problem munnadiyே pidikkalам | — | Low | — | **P1 — build (real gap)** |
| 35 | Prompt Caching — Implicit | Google automatic-a repeat content-a cache pannுm, cost குறையும் | ✅ Already work aagудhu, telemetry-um irukku | Yes | Keep | **Use internally, zero extra work** | Free cost saving | — | Low | — | P0 (already done) |
| 36 | Prompt Caching — Explicit | Namma manually "idha cache pannு" nu solрадhu | 🔴 Missing, **already decide pannirukanga** venaam nu (ADL-054) | Yes | Not now | **Defer** | — | ArcNave-la cache-worthy periya content (policy handbook) feature-e illa ippo | — | — | P3 |
| 37 | Batch Prediction | Periya amount velai-a ஒரே தடவை-la, cheap-a run pannрадhu | 🔴 Missing | Yes | Not now | **Defer** | — | ArcNave innum launch aagalaye, backlog data illa | — | — | P3 |
| 38 | Supervised Fine-Tuning/Distillation | Namma sondha data vachu AI-ku training kudுрадhu | 🔴 Missing | Yes | Never (as general strategy) | **Avoid — replace with deterministic/RAG logic** | — | Namma already "AI predict pannадhu" nu decide pannirukanga (RS-AIG-014) | High (trained-model risk, drift) | — | **Rejected** |
| 39 | Logprobs (confidence score) | Ovvoru vaartha-kkum AI-oda "confidence" number | 🔴 Missing | Yes | Internal diagnostics mattum | **Avoid as trust signal, allow for internal eval only** | — | Namma already deterministic re-verify pannுroam (better) | — | — | P3 |
| 40 | Cross-Provider Fallback | Gemini down-na, automatic-a Claude/OpenAI-ku switch aagுradhu | 🔴 **Missing** — periya gap, BKA-la kேlvi-e illai | N/A (ArcNave design) | Build now | **ArcNave must own — build fallback layer** | Vertex outage-la ella college-um AI illама poidum | — | **Very High (single point of failure)** | Monitoring + auto-switch + alert | **P0 — urgent, real gap** |
| 41 | Model Version Pinning/Alerting | Google model silent-a maathina, namakku theriyanumla | 🔴 Missing | N/A | Build monitoring | **ArcNave must own** | Google model maathina answer quality change aagалам, therியாma poyidum | — | Medium | Version-change alert mandatory | P1 |
| 42 | Per-Tenant Cost/Quota Control | Ovvoru college evlo AI use pannலam nu limit | 🔴 **Missing** — periya gap | N/A (ArcNave design) | Build now | **ArcNave must own — build now** | Real customer vandha, bill kattupadutha vேண்டியathu mandatory | — | **Very High (financial risk)** | Per-college quota + budget alert | **P0 — urgent, real gap** |
| 43 | Regional Availability/Data Residency | Data edhu region-la process aagудhu | 🟡 `location: 'global'` use pannుроam, alternative region verify pannala | Yes | Confirm compliance need | **Use internally, verify if compliance requires India-region** | — | Indian college data — residency question varalам | Medium (compliance) | Legal/compliance check | P2 |
| 44 | Audit Trail/Logging of AI Calls | Ovvoru AI call-um log aaguthaa nu check | ✅ `ai_llm_call` audit already irukku | N/A | Keep, expand for cost | **ArcNave-owned, keep** | Already strong | — | Low | — | P0 (already done) |
| 45 | Human Approval Workflow (L3 gate) | High-impact action AI pannுna, human confirm pannanum | ✅ `WorkflowService` gate already irukku, no exceptions | N/A | Keep | **ArcNave-owned, keep** | Core trust mechanism | — | Low | — | P0 (already done) |
| 46 | Multilingual/Translation | Vேறே language-la kேlvi kேttalum answer sollрадhu | 🟡 Gemini natively support pannுm, ArcNave-la explicit feature-a illa | Yes | Use as-is, no dedicated build | **Use internally, no new work needed** | Tamil/English mix already handle pannுthu (idhே Tanglish!) | — | Low | — | P2 |
| 47 | Vertex Capability Registry (control layer) | Ovvoru model/project/region-ku enna capability irukку nu central-a track pannрадhu | ✅ **Idhே intha session build pannitten** | N/A (ArcNave-owned meta-layer) | Keep, expand | **ArcNave-owned, keep, expand for #26/#34/#40 above** | Ella future decision-um idhோட mேlе than build aagும் | — | Low | — | P0 (already done) |

---

## Part 3: Multimodal Gap Analysis

| ID | Input Type | Has It Now? | Current Method | Native Gemini? | Should Use? | Safe Use Case | Unsafe Use Case | CEO Decision |
|---|---|---|---|---|---|---|---|---|
| M1 | Text | ✅ Full | Direct | Yes | Yes | Chat, summarize | — | Use now |
| M2 | PDFs | 🟡 Partial | pdfplumber (deterministic) + Tesseract fallback for scans | Yes (attempted, not default) | Only for identity-check, not counting | Attribution verify | Counting/sum | Deterministic stays primary |
| M3 | Word Documents | ✅ Full | `mammoth` library (deterministic) | Yes (unused) | No — library already correct | Extraction | — | Keep library-based |
| M4 | Scanned Documents | 🟡 Partial | Tesseract OCR, capped 30 pages | Yes (alternate) | Add Gemini vision for low-confidence cases | Low-quality scan escalation | Bulk default (cost) | Hybrid: Tesseract default, Gemini escalation |
| M5 | Images | ✅ Full | Native Gemini vision | Yes | Yes | ID/photo field extract | Unverified auto-record | Use now, human-verify |
| M6 | Handwritten Forms | 🔴 Weak | Tesseract (weak on handwriting) | Yes (better) | Yes, with mandatory verify | Admission form fields | Auto-publish without check | Use Gemini vision + human gate |
| M7 | Tables | 🟡 Partial | Deterministic (pdfplumber/library) — correct choice | Yes (rejected for math) | No for count/sum | Description only | Any arithmetic | Keep deterministic |
| M8 | Excel/Spreadsheet | ✅ Full | `exceljs` (deterministic), 2000-row cap | Not needed | No | — | — | Keep library-based |
| M9 | Audio | ✅ Full | Native Gemini | Yes | Yes | Voice note understanding | — | Use now |
| M10 | Voice Notes | ✅ Full | Same as audio | Yes | Yes | Staff/student voice message | — | Use now |
| M11 | Video | 🟡 Attempted, unmeasured | Native Gemini (untested per-codec) | Yes | Only if a real feature needs it | — | — | Defer, no feature exists |
| M12 | Screenshots | ✅ Full | Native Gemini (as image) | Yes | Yes | Bug report, UI issue | — | Use now |
| M13 | Campus Circulars | 🟡 Generic | Generic document upload, category-tagged, no special AI | N/A | Search/summarize only | Search via `search_documents` | Auto-decision from content | Use existing RAG |
| M14 | Student Documents | 🟡 Generic | Generic upload + `document_type_registry` | N/A | Extraction draft only | Draft admission field pre-fill | Auto-publish to record | Human verify mandatory |
| M15 | Attendance Evidence | 🔴 No dedicated path | No specific handling found | N/A | Very cautiously | — | Never auto-mark attendance from AI-read evidence | **Avoid auto-record — RS-ATT rule already protects this** |
| M16 | Fee Receipts | 🟡 Generic | Tagged as `fee_receipt` in registry, generic OCR path | Yes (untested for this type) | Extraction draft only | Pre-fill amount for staff review | Auto-post to fee ledger | Human verify mandatory |
| M17 | ID Cards | 🟡 Generic | Generic image upload | Yes | Field extraction draft | Pre-fill name/ID number | Auto-verify identity | Human verify mandatory — never identity-decide |
| M18 | Certificates | 🟡 Generic | Generic upload | Yes | Field extraction draft | Pre-fill certificate details | Auto-validate authenticity | Human verify mandatory |
| M19 | Timetables (as documents) | 🟡 Generic | Generic upload, versioned (RS-ASM-007) | Yes | Diff/extract, class-level publish already governed | Already correctly built | — | Keep as-is (already good) |
| M20 | Question Papers | 🟡 Generic | Generic upload under Examination category | Yes (unused) | Search/organize only | Filing, retrieval | Auto-grading/leak risk | Very cautious — never auto-process content |
| M21 | Answer Sheets | 🔴 No feature | Not found as a distinct capability | Yes (risky) | Do not build without explicit product decision | — | Auto-grading = academic integrity risk | **Avoid until its own dedicated decision** |
| M22 | Reports | ✅ Full | Own generators (pdf/excel/word/csv) — deterministic | Not used | No | — | — | Keep own generators |
| M23 | Notices/Admin Records | 🟡 Generic | Generic document upload | N/A | Search/summarize | — | — | Use existing RAG |

---

## Part 4: Parameters and Controls Register

| ID | Parameter/Control | Tanglish Meaning | Use/Avoid/Conditional | Default | Why | Reliability Impact | CEO Rule |
|---|---|---|---|---|---|---|---|
| C1 | Temperature | AI-oda "creativity" level | Conditional | Low, for extraction | Consistent factual answer venum | High temp = unpredictable | Extraction-ku low, chat-ku default |
| C2 | Max Output Tokens | Ore பதில்-oda size limit | Use | 65,536 | Already tested ceiling | — | Keep as-is |
| C3 | Structured Output/Schema | Fixed JSON format force pannрадhu | **Use, mandatory** | Enabled for every extraction tool | Wrong-format risk குறையும் | High currently (missing) | Build P0 |
| C4 | System Instructions | AI basic behavior lock pannрадhu | Use | Every call | Injection resist pannрадhu | Low | Keep |
| C5 | Context Size | Ore prompt-la data amount | Conditional | Chunked, bounded | Cost/latency control | Medium | Preflight count before large sends |
| C6 | File Handling (inline vs GCS) | File anuppுmbodhu evvidham anuppрадhu | Conditional | Inline for small, GCS for large (future) | Size limits irukku | Medium | Never raw gs:// to frontend |
| C7 | Grounding (search) | Real-world info fetch pannрадhu | Conditional, opt-in | Per-college toggle | Fresh info venum sometimes | Medium (hallucination) | Untrusted-data boundary mandatory |
| C8 | Citations | Source URL kaatрадhu | Use when grounding used | Always show source | Trust building | Low | Never hide source |
| C9 | Function Calling | Tool select pannрадhu | Use | Single-call per turn | Core mechanism | Low | Keep sequential |
| C10 | Tool Usage (parallel) | Onnukku mேl tool same time | Avoid for writes | Off | Order-confusion risk | High for writes | Read-only future exception only |
| C11 | Safety Settings | Bad content filter | Use default | Google default | — | Low | Revisit only if issue |
| C12 | Prompt Caching (implicit) | Auto cost-saving cache | Use | Always on (automatic) | Free saving | Low | Keep |
| C13 | Prompt Caching (explicit) | Manual cache setup | Avoid for now | Off | No cache-worthy content yet | — | Revisit if policy-handbook feature built |
| C14 | Batch Jobs | Bulk cheap processing | Avoid for now | Off | No backlog yet | — | Revisit post-launch |
| C15 | Retries | Failed call-a again try pannрадhu | Use | 3 attempts, exponential backoff | Already correct | Low | Keep |
| C16 | Fallback Models/Providers | Vera provider-ku switch aaguradhu | **Use, build now** | Auto-switch on sustained failure | **Missing today — real risk** | **Very High** | **Build P0** |
| C17 | Regional Availability | Edhu region-la process aagுthu | Conditional | `global` unless compliance needs India-region | — | Medium (compliance) | Verify legal requirement |
| C18 | Logging | Every call log aaguthaa | Use | Always | Audit trail core | Low | Keep, expand for cost |
| C19 | Monitoring | Real-time problem kaatрадhu | **Use, build** | Alert on failure-rate/cost spike | Currently missing dashboard | Medium | Build with C16/C20 |
| C20 | Cost Control | Kelavu limit vekрадhu | **Use, build now** | Per-college quota + alert | **Missing — real financial risk** | **Very High** | **Build P0** |
| C21 | Rate Limits | Evlo fast call panна mudiyum | Conditional | Per-tenant cap | Prevent one college blocking others | Medium | Build with C20 |
| C22 | Permissions | Yaru enna AI action pannலam | Use | Already RBAC-gated | Already strong | Low | Keep |
| C23 | Privacy/Data Retention | Data evlo naal vachurupom | Conditional | Match ArcNave's own retention policy, not Google's default | Compliance | Medium | Legal review |
| C24 | Model Version Changes | Google model silent maathinal | **Use, build alert** | Pin + alert on change | **Missing today** | Medium | Build P1 |
| C25 | Human Approval | High-impact action confirm | Use | Always for L3 | Core trust | Low | Keep, never bypass |
| C26 | Audit Trails | Ella AI action-um record aaguthaa | Use | Always | Already strong | Low | Keep |

---

## Part 5: Ownership Boundaries

**ArcNave must own fully (never delegate to Vertex/Gemini):**
Identity/authentication, permissions (RBAC), tenant isolation (RLS), attendance/marks/fees final records, document binary storage, workflow approval, audit trail, business rules, own RAG (`search_documents`), own sandbox (`execute_code`), own report generators, own deterministic table extraction.

**Can use from Vertex AI as pure infrastructure:**
Text/image/audio generation and understanding, embeddings, web search grounding, URL retrieval, multi-step tool planning, implicit prompt caching.

**Must sit behind an ArcNave abstraction layer (never call the provider SDK directly from a route/service):**
Everything already does — `aiProviders/*` adapter pattern, `vertexCapabilityRegistry.js` (this session's build). Extend the same pattern for #16 (cross-provider fallback) and #26 (thinking profiles).

**Must have a fallback provider or fallback workflow:**
Every business-critical AI-assisted flow (tool select, extraction, chat) — **currently missing**, this is the #40 P0 item.

**Must always require human approval:**
Any AI-extracted value entering an official record (marks, fees, attendance, identity, certificates, timetable publish) — already governed by RS-AIG-012/RS-AIG-004, keep as-is.

**Must never be used for official campus records without validation:**
Handwritten form reading, fee receipt extraction, ID card extraction, certificate extraction, any document-table count/sum — all must stay draft-only until a human confirms.

**Should not be built now:**
Vertex AI Search (private-data grounding) without its own comparison pass, computer use, Vertex's own code execution, fine-tuning, batch prediction, explicit caching, video/audio timestamp grounding, answer-sheet auto-grading.

---

## Part 6: Final Priorities

**P0 — Must decide or fix immediately**
- #40 Cross-provider fallback (real reliability gap, zero mitigation today)
- #42 Per-tenant cost/quota control (real financial risk before real customers onboard)
- #12 Structured output/JSON schema enforcement (hardens existing, already-governed extraction flows)
- #18 Vertex AI Search Grounding — **decide, don't build** (own-RAG-vs-managed-RAG comparison needed)

**P1 — Build next**
- #26 Thinking levels (fast/balanced/deep)
- #34 Token counting preflight
- #21 Spatial grounding (PDF/image only)
- #5/#6 Gemini-vision OCR escalation tier for handwriting/low-quality scans
- #41 Model version pinning/alerting

**P2 — Important but can wait**
- #2 Native PDF reading as identity-verification aid (not counting)
- #29/#31/#43 Safety settings, temperature tuning, regional/data-residency confirmation
- #33 Context-window verification against real limit

**P3 — Experimental/optional**
- #10/#22 Video understanding, temporal grounding — no feature exists yet
- #14 Parallel function calling — read-only only, revisit later
- #36/#37 Explicit caching, batch prediction — no backlog/content yet
- #39 Logprobs — internal diagnostics only

**Rejected — do not build or depend on**
- #23 Computer Use (Preview)
- #24 Vertex/Gemini native code execution (redundant, weaker than #25)
- #27 Chain-of-thought visibility as evidence
- #38 Supervised fine-tuning/distillation
- M15 Auto-marking attendance from AI-read evidence
- M21 Auto-grading answer sheets

---

**Naan CEO-a nu solрадhu na**, ArcNave-ku AI **"periya feature list"** venaam — **"nambakkூдிya, campus-a wrong pannாma velai seyya" AI** venum. Idhu than #40 and #42 P0-la irukрадhukku reason — ivை glamorous illa, aana ivை illama, real college data-oda velai pannுmbodhu ArcNave romba fragile-a irukும்.
