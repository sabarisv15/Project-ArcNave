# ARCNAVE Scope & Conventions — Tanglish-la Elaborate Explanation

**Yeppadi intha document irukku:** Idhu `00-foundation/scope-and-conventions.md` file-a, software-spec background illatha oru nallavare-kum puriyara maathiri, Tanglish-la (Tamil + English kalandhu, Roman script-la) detail-a explain pannradhu. Original document-la irukra ella 8 sections-um, adhula reference pannina ella rule file-galum (17 domain files) full-a padichu, adha vachi eludhapatta document idhu. Ethuvum skip pannala, ethuvum one-liner-a mattum vidalai.

---

## 1. Scope — ARCNAVE Enna Cover Pannudhu

ARCNAVE nu solradhu oru **multi-tenant campus automation platform**. "Multi-tenant" nu solra vaarthaikku meaning enna na, ARCNAVE oru single software system, aana adhula pala colleges (tenants) separate-a, oruvanoda data innoruvanukku theriyaama operate pannalam. Ellarum same software use pannaanga, aana ovoru college-oda data adha college-ku mattum thaan visible.

Idhu cover pannra area full-a:

- **Platform governance & tenant onboarding** — ARCNAVE company (Platform Admin) oru pudhu college-a eppadi system-la add pannudhu, adha eppadi manage pannudhu.
- **Institutional identity** — college-la irukra L1 (Principal), L2, L3 (HOD), L4 (Class Tutor) nu irukra authority structure.
- **Academic operations** — academic year, curriculum, timetable.
- **Attendance** — hour-wise attendance marking.
- **Classroom authority** — ovoru class-ukum evan responsible-nu.
- **Student and staff lifecycles** — admission-la irundhu alumni varaikkum, hire-la irundhu deactivation varaikkum.
- **Finance** — fee status (Paid/Not Paid) mattum track pannradhu, amount-e illa.
- **Assessment and documents** — marks, exam documents, report generation.
- **Workflow and approvals** — evan approve pannanum nu process.
- **Notifications** — system messages, alerts.
- **AI authority** — AI enna panna mudiyum, enna panna koodadhu.
- **Data integrity and multi-tenancy** — data safety, retention, tenant isolation.

Idhu ellame ARCNAVE-oda full scope. Aana idhukku equal-a mukkiyamana part enna na — **enna ARCNAVE panradhu illa** nu clear-a solradhu.

### 1.1 Out of Scope — Enna Vendaam nu Declare Pannirukkanga (Mistake-a Illa, Purpose-oda)

Intha 7 items ARCNAVE-la **deliberate-a** exclude panniyirukanga — accident-a miss aagala, thெருந்தெளிவா ("intentionally") vidapattadhu. Ovoru item-ukkum, adha decide panna real rule oru file-la irukku. Yen idha ippadi separate-a pottu vachirukanga na — future-la yaaraavadhu "இது ஒரு gap" nu ninachi confuse aagakoodaadhu nu.

Ippo ovoru item-ayum, adha governing rule-oda **real reasoning**-oda paathu paakalam:

**1. Fee amounts, schedules, ledgers, gateways, fines, concessions, refunds** — Governing rule: **RS-FIN-001**.
ARCNAVE fee amount nu solra concept-ae vechirukala. Fee-structure record illa, fee amount illa, fee schedule illa — so, "fee change" nu approve panna action-e illa. Student evlo kattanum nu ARCNAVE-kku theriyadhu — adhu completa college-oda own accounting system-oda vேலை. Payment gateway integration, ledger/accounting, receipt generation (ledger entry-a), fine calculation, concession processing, refund workflows — ella-um exclude. ARCNAVE track panradhu Paid/Not Paid nu rendu status mattum — receipt document evidence-a store pannalam, aana adhu ledger entry-a illa. Idhu yen na: ARCNAVE oru accounting software illa, campus operations automation software.

**2. Hall tickets and examination eligibility** — Governing rule: **RS-ASM-009**.
Hall ticket generate pannradhu, approve pannradhu, block pannradhu, manage pannradhu — ellame ARCNAVE never pannaadhu. Idhu University-oda alladhu DOTE-oda (Directorate of Technical Education) alladhu appropriate external authority-oda vேலை. ARCNAVE class-la irukra Examination section-la related official documents-a store panna mattum help pannum (Tutor discretion-la).

**3. Student/parent leave request and approval** — Governing rule: **RS-ATT-007**.
ARCNAVE-la student alladhu parent leave-ku request potu approve vaanga nu oru workflow-e illa. Attendance nu solradhu evlo periods actual-a mark pannirukanga nu ah mattum-thaan base pannirukku. Oru day full-a absent nu vandha, adhu automatic-a andha naal-oda ella periods-layum absent-nu mark aanadhu-nala varradhu — separate "full-day leave" concept-e kidayadhu. Medical certificate alladhu leave letter college-ku venumna, adhu ERP-kku veliya handle pannanum. AI ஒருபோதும் "இது approved leave" nu ninachi attendance-a override pannadhu.

**4. Parent accounts, logins and dashboards** — Governing rule: **RS-STU-012**.
ARCNAVE parent-ku separate login, account, dashboard onnum kudukkadhu. Attendance, marks, documents, notices — ellame authorized institutional staff mattum access pannuvanga, student portal enable pannirundha student mattum access pannuvaanga. Rendu-vazhi (two-way) parent communication — meeting, discussion — ERP-kku veliya nadakkanum. Aana **one-way** system alerts — Send Alert, OTP — parent-oda phone-kku direct-a pogum (idhu different capability). AI parent-a system user-a treat pannadhu.

**5. A separate Exam Cell module** — Governing rule: **RS-ASM-001**.
Separate "Exam Cell" nu oru module ARCNAVE-la illa. Adhukku pathila, ovoru class-kum adha class-oda L4 (Class Tutor) own pannra generic "Examination section" irukku — adhula University/DOTE exam timetables, related documents PDF-a, version history-oda store pannalam.

**6. Predictive / machine-learning forecasting of student outcomes** — Governing rule: **RS-AIG-014**.
ARCNAVE-la trained predictive model onnum illa. "Yaru next semester fail aaguvanga" nu kettaalum, system honest-a "andha capability illa" nu solum, guess pannadhu. ARCNAVE-la irukra AI ellam LLM tool-calling plus retrieval mattum-thaan — classical ML illa. Document classification kooda exact/alias match mattum use pannudhu, similarity-matching illa — compliance-sensitive area-la silent mistake varakoodadhu nu.

**7. Student logins and dashboards** — Governing rule: **RS-IDN-013**.
Students login pannradhu, dashboard use pannradhu — idhu illa. Students "record subjects" — attendance/marks/documents-oda record vechirukra "objects" — aana system-oda "actor" illa (student portal separately enable panninaanga na mattum thaviram). Dashboards role-based-a, institution configure pannalam. No student authentication path exists.

---

## 2. Normative Language — MUST, SHOULD, MAY Ellam Enna Artham

Spec document full-alum konjo specific vaarthaigal use pannirukanga — idhu ellame **"eppadi kandippa follow pannanum"** nu level-a solra vaarthaigal. Idhu RFC 2119 nu solra oru international standard-la irundhu edukkapatta convention (idhu oru technical name mattum, artham simple):

- **MUST / MUST NOT** = kandippa follow pannanum / kandippa panna koodaadhu. Idha violate pannradhu oru defect (bug) nu consider pannuvaanga.
- **SHALL / SHALL NOT** = MUST / MUST NOT ku same meaning-thaan, vera vaarthai mattum.
- **SHOULD / SHOULD NOT** = pannradhu nallathu, recommend pannaraanga. Aana ஏதோ reason irundha, pannama iruntha adha document pannanum (justification kudukanum).
- **MAY** = optional. Andha specific person/role-ku permission irukku, aana kandippa pannanum-nu illai — avanga decide pannalam.
- **IS / ARE** (statement-a solradhu) = idhu already-irukra oru fact-a state pannradhu — "system already ippadi-thaan work pannum" nu.

**Example ஒவ்வொன்றுக்கும்:**

- MUST example: "AI hard-delete pannakoodaadhu" (RS-AIG-015) — idhu absolute prohibition, exception-e illa.
- SHOULD example: "Backup integrity periodically verify pannanum" — pannaama iruntha, adhukku reason irukkanum.
- MAY example: "Institution MAY relabel L1 seat 'Director' nu, 'Principal' nu illama" (RS-IDN-012) — idhu optional, institution decide pannalam.

---

## 3. Rule ID System — RS-XXX-NNN Format

Ovoru rule-kkum permanent-a oru identifier irukku, `RS-<DOMAIN>-<NNN>` format-la. Example: `RS-ATT-004`.

- **RS** = "Rule Specification" nu short form.
- **DOMAIN** = 3-letter code, edhu subject-ku belong aagudhu nu (example: ATT = Attendance, FIN = Finance).
- **NNN** = number, zero padded (001, 002...), oru thadava kudutha appuram andha number vera edhukkum use pannamatanga.

**Permanent-a irukkum, delete aana kooda number reuse aagadhu.** Oru rule withdraw panna vendina (venaam-nu mudivu pannina), adha rule-oda identifier அப்படியே இருக்கும், status "Withdrawn" nu maarum, adha replace pannina puthu rule-ku pointer irukkum. Andha number vera edhukkum kudukkamatanga — history preserve aagum. Renumbering completely prohibited.

இது ஏன் முக்கியம்: வருஷக்கணக்கில் யாராவது "RS-ATT-004" nu reference pannirundha, andha reference eppozhudhume valid-a irukkanum — number maari, meaning maari poidama irukkanum.

---

## 4. Domain Codes — Ovoru Domain-um Enna Cover Pannudhu

Original document-la §4 table-la **14 domains mattum** list panniruntha (GOV, TEN, IDN, STF, CLS, ACA, ATT, STU, FIN, ASM, WFL, NTF, AIG, DAT). Aana `10-specification/` folder-la real-a **17 rule files** irukku — mudhu 14-kum extra-a RS-ADM (admission wizard), RS-ANL (analytics governance), RS-PRF (personal workspace) real content-oda irukku, aana andha official table-la avanga name illa (idha pathi §Kandupudichadhu section-la detail-a paakalam).

Ippo ella 17 domain-um enna real-a cover pannudhu nu elaborate-a paakalam:

### GOV — Platform Governance & Onboarding (`RS-GOV-governance.md`, 17 rules)

Idhu ARCNAVE company (Platform Admin) oda role mattum boundary-a define pannudhu. Platform Admin oru ARCNAVE employee — evan academic decision edukkadhu, evanukku eந்த college-oda reporting hierarchy-layum seat illa (RS-GOV-001). Onboarding time-la mattum Platform Admin college create pannuvaru, departments create pannuvaru, initial config set pannuvaru (RS-GOV-003) — appuram day-to-day operation ellame college-oda own L1 (Principal) login-la irundhே manage aagum, Platform Admin involvement illama (RS-GOV-004). Interesting rule oru — **exactly 5 structural actions** mattum Platform Admin key-gated-a pannanum: L2 configuration, affiliation changes, new campus add pannradhu, department merge/rename, accreditation changes (RS-GOV-005). Idhukku L1 oru "single-use authorization key" generate pannanum, adha Platform Admin-kitta kudukanum — andha key 7 days-la expire aagum, oru specific change-kku mattum valid. College-oda lifecycle (`provisioning → ready → active → suspended/archived`) kooda idhula-thaan define aagirukku (RS-GOV-010). Ippo license (Trial/Full) mattrum principal invitation flow kooda idhula rules irukku.

### TEN — Multi-Tenancy & Platform Isolation (`RS-TEN-tenancy-security.md`, 8 rules)

Idhu ARCNAVE-oda mukkiyamana security foundation. Ovoru database query-yum PostgreSQL-oda **Row-Level Security (RLS)** vachi protect pannaraanga — application code-la `WHERE college_id = ...` nu type panradhu mattum poathadhu, oru mistake nadandha oru college data innoru college-ku leak aagum, so database level-le block pannaraanga (RS-TEN-001). Migration role (database structure maathura role) mattum application role (day-to-day query pannura role) rendu vera roles-a irukkum — application role-kku SUPERUSER access illama irukkanum (RS-TEN-003). Platform Admin only actor edhu completely velila irundhே operate pannudhu, separate application-la (`admin.arcnave.com` vs `<college>.arcnave.com`) (RS-TEN-004). Multi-device login allow pannudhu, MFA institution-per configure pannalam (RS-TEN-008).

### IDN — Institutional Identity & Authorization (`RS-IDN-identity.md`, 14 rules)

Idhu ARCNAVE-oda unique-ana identity model — `Position → Position Account → Occupant` nu solra structure, `Position → User` illa (RS-IDN-001). Idhu yen important na: **seat (position) permanent-a irukkum, adhula irukra aal (occupant) maarikittu irukkum.** Example: "Principal" position permanent-a irukkum, aana andha seat-la evanavudhu maari maari varuvaanga — appadi maarina, password reset, session revoke, MFA clear ella-um automatic-a nadakkum, aana mailbox, permissions, audit history maaraadhu (RS-IDN-010). Position Accounts L1, L2, L3-kku, and L4 "position_type" irukra seats-kku (Class Tutor maadhiri) mattum irukkum — plain L4 staff (position_type illama) idhula varaadhu (RS-IDN-003). "L1–L4" nu solradhu authority structure, "Principal/HOD/Class Tutor" ellam just display labels — college adha "Director"/"Dean" nu maathikalam, underlying logic maaraadhu (RS-IDN-012). Students-ku login/dashboard onnume illa (RS-IDN-013) — idhu §1.1-la paathom.

### STF — Staff Lifecycle (`RS-STF-staff.md`, 15 rules)

Staff hire pannradhu, deactivate pannradhu, position change pannradhu ellame idhula. Staff registration L3 (HOD) initiate pannanum — staff self-a request panna mudiyaadhu (RS-STF-001). Invite → accept → L3 approve → (L2 irundha) L2 approve → **L1 approve (kandippa, L2 irundhaalum)** → account live; L2 illana neraa L1 approve → account live (RS-STF-002 — 2026-08-17 correction: L1 ippo mandatory final approver, munnadi "L2 or L1" nu irundhadhu update pannirukanga; implementation code idha vachi innum re-verify pannala, so Conformance "Undecided"-a maathiyirukku). Interesting-a, deactivation lower-friction-a irukku — L3 own department-la evan venumnalum deactivate pannalam, approval chain-e illama (RS-STF-005) — access kudukradhu kashtam, thirumba edukkardhu easy-nu deliberate design. Ovoru staff-kum "Permanent Internal Staff ID" irukkum, avanga Employee Code maarina kooda idhu maaraadhu (RS-STF-004). Recent addition-a Teaching Journal (per-hour teaching log, RS-STF-012), self-service profile (name, phone, DOB — payroll data thavira, RS-STF-013), phone OTP verification (RS-STF-014), staff directory (basic "who's who" — everyone paakalam, RS-STF-015).

### CLS — Classroom (Level 4) Authority (`RS-CLS-classroom.md`, 13 rules)

Idhu class-level operations-a govern pannudhu. First-year students permanent-a department/class structure-kku veliya (RS-CLS-001) — second year-la mattum-thaan department-ku assign aavaanga. Class nu solradhu (department, semester number) key-oda oru permanent slot, occupants (students) yearly rotate aagum (RS-CLS-002). L3 evan-a class-ku assign pannuvaaro, adhே "credentialing act" — assign pannradhu-ne credential kudukradhu (RS-CLS-003). Substitute faculty request pannalaam, aana L3 approve pannanum, andha substitute same department-la irukkanum, andha exact time-la genuinely free-a irukkanum nu check pannuvaanga (RS-CLS-007). Idhula mukkiyamana pattern — **ownership-based authority**: title illama, data-oda real owner mattum-thaan write pannalam (RS-CLS-009) — idhu whole spec-oda core principle. "Community" (caste category maadhiri) ordinary field-a treat pannaraanga, Aadhaar maadhiri restrict pannala (RS-CLS-010).

### ACA — Academic Year, Curriculum & Timetable (`RS-ACA-academic.md`, 11 rules)

Academic year lifecycle (`Draft → Active → Completed`) idhula define aagirukku — oru time-la oru active academic year mattum (RS-ACA-002). Timetable approval oru interesting workflow: L4 initiate pannuvaaru (AI auto-generation alladhu manual upload), L3 review pannuvaaru (aana final approval illa), **L1 kandippa final approver** (mandatory floor, configuration-la remove panna mudiyadhu) (RS-ACA-004). Timetable auto-generation ovoru faculty-oda availability check pannum, whole institution-la irukra approved allocations-a vachi (RS-ACA-005). Curriculum ("regulation") versions multiple-a coexist pannalam, student regulation admission time-la fix aagum (RS-ACA-009).

### ATT — Attendance (`RS-ATT-attendance.md`, 9 rules)

Attendance hour-wise mark pannanum, session start-la irundhu 30 minutes varaikkum window-la (RS-ATT-001). **Ownership per-hour** — andha specific hour-kku assign aana staff mattum, illa avanga approved substitute mattum mark pannalam — L3/L4/L1 evarum illa, level irundhaalum sari (RS-ATT-002). Lock aana appuram change panna vendina, adhu "correction" — Subject Faculty submit pannuvaaru, L4 approve pannuvaaru, single-tier-a (RS-ATT-004). Interesting-ah, natural language-la AI-kitta message anupinaalum attendance mark pannalam — "mark roll numbers 35, 67, 25 absent" nu solli — aana idhu andha faculty own class-kku mattum, AI adha same eligibility check pannum human route-oda same-a (RS-ATT-005). 5 consecutive days absent-aana automatic-a L3-kku notification pogum, review pannanum (RS-ATT-008). "Final year" nu structured field illa, soft text match mattum-thaan (RS-ATT-009).

### STU — Student Identity, Lifecycle & Records (`RS-STU-students.md`, 13 rules)

Student register number tenant-la unique-a irukkanum (RS-STU-001). **Aadhaar** — idhu ARCNAVE-la identity, dedup, import, search, AI reasoning, reporting engum use pannamatanga — legal compliance requirement (Aadhaar Act), optional encrypted restricted field mattum-a irukkum (RS-STU-002). Idhu original requirements-ku ஒரு deliberate deviation, thirumba "correct" panna koodadhu (RS-STU-003). Business identity (dedup/import) Register Number, EMIS Number, Admission Number vachi mattum — Aadhaar illa (RS-STU-004). Student lifecycle: `Applied → Admitted → Active → (Suspended/Discontinued/Debarred/Dismissed) → Graduated → Alumni` — Alumni terminal state (RS-STU-006). Suspended/Discontinued/Debarred/Dismissed nu maadhiri high-severity transitions-kku L3 mandatory minimum approval floor venum (RS-STU-007). Parent accounts/logins illa nu §1.1-la paathom (RS-STU-012). Student flag — manual-a raise pannalam (append-only history), optional remark-oda (RS-STU-013).

### FIN — Finance (`RS-FIN-finance.md`, 6 rules)

Idhu already §1.1-la elaborate-a paathom — fee amount track pannadhu (RS-FIN-001). Fee status first-time mark panradhu L4 own class-kku, receipt attach pannanum (RS-FIN-002). Aprom edit panna vendina, adhu correction, L3 approve pannanum (RS-FIN-003). Exactly rendu status mattum: Paid, Not Paid — Partial illa, amount illa nu (RS-FIN-004). Scholarship eligibility Class Tutor unilateral-a decide pannuvaaru, approval engine-la irundhு exempt (RS-FIN-005) — AI advisory signals mattum kudukkum, decision AI ஒருபோதும் edukkadhu. Fee data "Restricted" classification-la irukku (RS-FIN-006).

### ASM — Assessment, Examination & Documents (`RS-ASM-assessment-documents.md`, 12 rules)

Exam Cell illa nu §1.1-la paathom (RS-ASM-001). Marks first-time entry Subject Faculty direct write, weightage/grade automatic calculation edhுவும் illa (RS-ASM-002). Correction workflow attendance maadhiri-thaan — L4 approve pannuvaaru (RS-ASM-003). **`DocumentService`** system-la irukra **ella files-oda sole owner** — vேறு எந்த service-um, AI tool-um direct-a storage-ku write pannadhu (RS-ASM-005). Reports always `ReportModel → Generator → DocumentService → Storage` chain-la generate aagum (RS-ASM-006). Document classification exact/alias match mattum use pannum, fuzzy matching illa — wrong category silent-a accept aaga koodadhu nu (RS-ASM-008). Hall tickets exam eligibility out-of-scope nu paathom (RS-ASM-009). Storage quota (`storage_tier`) real-a enforce pannaraanga — quota exceed aana upload reject aagum (RS-ASM-011). Assessment types create pannradhu ippo edhurumana staff-ku permission irukku (creator-only edit) (RS-ASM-012).

### WFL — Approval Workflow (`RS-WFL-workflow.md`, 8 rules)

ARCNAVE-kku **oru** configurable workflow engine mattum irukku — module-per separate approval system illa (RS-WFL-001). Institution ovoru module-kum own approval chain configure pannalam (Tutor-only, Tutor→HOD, HOD→Principal, etc.) (RS-WFL-002). Aana chila modules "mandatory floor" hard-code pannirukanga — configuration-la andha floor skip panna mudiyadhu: Timetable approval-kku L1 venum, high-severity student status change-kku L3 venum (RS-WFL-003). Exactly **rendu** subjects mattum approval engine-la irundhே completely exempt — Scholarship eligibility, Send Alert (RS-WFL-004). Approver evan nu live position-la irundhே resolve pannaraanga, static role label-la irundhு illa (RS-WFL-005). Yaaraiyum thangala submit pannina request-a thaangalே approve panna mudiyadhu — self-approval prohibited (RS-WFL-006). Temporary delegation support pannaraanga (RS-WFL-007).

### NTF — Notifications (`RS-NTF-notifications.md`, 8 rules)

Ovoru outbound notification-um `draft → approved → dispatched` ledger-la record aagum — direct-a send aaga mudiyadhu (RS-NTF-001). Delivery attempt ellame track pannaraanga (RS-NTF-002). **Automatic academic/business alerts illa** — attendance, marks, timetable changes-kku automatic notification varadhu, staff Send Alert use pannanum (RS-NTF-004). Aana **system notifications** (OTP, login credentials, password reset, substitute request, 5-day absence flag, high-severity student status) automatic-a pogum, draft/approve step illama (RS-NTF-005). Send Alert — timetable-assigned edhுவும் staff, own class-ku mattum, plain text WhatsApp message, human review pannanum send pannradhukku munnaadi (RS-NTF-006, RS-NTF-007). Student/parent OTP WhatsApp mattum use pannum, SMS illa (RS-NTF-008).

### AIG — AI Authority & Governance (`RS-AIG-ai-governance.md`, 16 rules)

Idhu AI-oda authority levels-a govern pannudhu — 3 levels: **L1 (Inform)** — search/explain, approval venaam; **L2 (Generate)** — reports/documents create pannradhu, external effect illa, approval venaam; **L3 (Act)** — email anuppradhu, records modify pannradhu, delete pannradhu — **eppozhudhume approval venum, exception illa** (RS-AIG-001). AI tools business services mattum call pannanum, database direct-a touch pannakoodaadhu (RS-AIG-002). Document/OCR content ellame "untrusted data" — instructions-a treat pannakoodaadhu, prompt injection-a thadukka (RS-AIG-003). AI enna correction/mutation pannina, adhu WorkflowService vazhiyaaga mattum pogum (RS-AIG-004) — AI submit panradhukku munnaadi user-kitta explicit confirmation kekkanum (RS-AIG-005). Data classification (Internal/Confidential/Restricted) mattrum action level rendu independent checks (RS-AIG-006). AI oru tool L1/L2-a register panna vendina, "same actor, same scope + already direct for human + never delete" ---3 conditions ellame satisfy pannanum (RS-AIG-007). Predictive/ML forecasting illa nu §1.1-la paathom (RS-AIG-014). AI-kku attendance/fee/marks-la **hard-delete capability eppozhudhume kidayadhu**, even L3-la approval-oda kooda (RS-AIG-015).

### DAT — Data Integrity, Retention & Audit (`RS-DAT-data-integrity.md`, 9 rules)

**Oru record-um permanent-a delete aagadhu** normal operations-la — archive pannuvaanga, hard-delete illa (RS-DAT-001). Idhu correction principle-oda core statement: original value delete pannadhu, approved correction puthu effective value aagudhu, dependent calculations recompute pannum (RS-DAT-002) — idhu attendance, marks, fee status ellathukum common pattern. Archived records read-only-a irukkum, restore explicit authorization venum (RS-DAT-003). Historical records adha create panna context-lae irukkum, later structure-ku maathi rewrite pannaadhu (RS-DAT-004). Backup/DR institution-per configure pannaraanga, restore drills actually conduct pannanum, assume pannakoodaadhu (RS-DAT-005). Central audit log append-only, edhuvum modify panna mudiyadhu (RS-DAT-006). Migrations ellame reversible-a, idempotent-a, batched-a irukkanum (RS-DAT-007). Import/export per-module opt-in-a irukku, Aadhaar exclusion respect pannanum (RS-DAT-008). Declared data-quality limitations (final year soft-match, document classification granularity) idhula register aagirukku (RS-DAT-009).

### ADM — Student Admission Wizard (`RS-ADM-admission-wizard.md`, 4 rules) — *Official table-la illa, aana real content irukku*

Idhu 2026-07-25-la add pannirukanga — `studentAdmissionDraftService` nu solra full feature already shipped-a irundhachi, aana adhukku governing rule edhuvum spec-la illa nu gap kandu pudichi close pannirukanga. Admission draft nu solradhu adha create panna staff member-kku mattum personal-a irukkum — department-wide illa (RS-ADM-001). AI document extraction OCR mattrum AI vechi field values propose pannum, review checklist-oda — aana **draft-a AI complete panradhu illa, adhu evlo confident-a irundhaalum** — completion eppozhudhume separate human action (RS-ADM-002, RS-ADM-003). Draft document storage temporary mattum, completion aana appuram real permanent document-a maarum, draft copy discard aagum (RS-ADM-004). Idhu students section-oda extension-thaan — draft complete aana appuram, adhu already-irukra normal student-creation rule (RS-CLS-004) vazhiyaagave real student-a maarudhu.

### ANL — Analytics Governance (`RS-ANL-analytics-governance.md`, 4 rules) — *Official table-la illa, aana real content irukku*

Idhu-um 2026-07-25-la add pannirukanga — `AnalyticsService` (Module 10) already shipped-a irundhachi, adhukku governing rule illa nu close pannirukanga. Idhu analytics calculations enna nu redesign pannadhu — evan andha number-a paakalam nu mattum govern pannudhu. Analytics data-kku separate access model illa — adhu summarize pannra underlying data-oda ownership boundary-yே inherit pannum: tutor own class analytics paakalam, HOD own department, Principal whole college — percentage-a aggregate pannradhu vachi visibility loosen aagadhu (RS-ANL-001). AI analytics data-a read/summarize pannalam, aana adha vachi **thaanaa oru action edukkadhu** — example: "class 62% attendance"-nu solli, adha vachi thanaa HOD-kku notify pannadhu, andha notification already-irukra absence rule vazhiyaaga mattum pogum (RS-ANL-002). Analytics data-quality limitations ellame inherit pannum — percentage nu solli adhu more accurate-a aagadhu (RS-ANL-003). Analytics deterministic aggregation mattum, prediction/forecasting capability illa (RS-ANL-004).

### PRF — Personal Workspace (`RS-PRF-personal-workspace.md`, 3 rules) — *Official table-la illa, aana real content irukku*

2026-07-26-la add pannirukanga — Personal Notes, Activity Timeline, User Preferences moonu features-um shipped-a irundhachi, governing rule illama. Idhu spec-la vera ella domains-kum **opposite** — vera ella domain-um shared/institutional record-a govern pannum, idhu **completely private-a irukra** capability-a govern pannudhu. Personal note adha create pannina aal-kku mattum private-a irukkum — Principal kooda paakka mudiyadhu (RS-PRF-001). Activity timeline evan own account-oda every audited action paakalam, vera evarோdayum paakka mudiyadhu — self-only (RS-PRF-002). User preferences (Saved filters, dashboard layout) generic key/value store-la self mattum store pannalam, backend adha validate/interpret pannadhu (RS-PRF-003). Idhula "AI parity" nu oru special note irukku — AI andha authenticated account already GUI-la panna mudiyra edhavadhu pannalam, adhukku mேلா onnum illa, kammi-um illa.

---

## 5. Rule Record Schema — Ovoru Rule-kkum Irukra 12 Fields

Ovoru rule-um oru statement-oda start aagum, adhukku appuram fixed 12 metadata fields irukkum. Idhu ella rule-kkum kandippa irukkanum — apply aagalana field-la `—` nu podanum, mattume skip panna koodaadhu.

1. **Owner** — Andha rule-a enforce panna responsible-ana single Business Service (example: `FinanceService`).
2. **Authority** — Andha rule-a exercise pannalaam nu permission irukra actor(s) (example: L4, L1, Platform Admin).
3. **Depends on** — Idhu meaningful-a irukanumna, edhavadhu vera rules true-a irukkanum. Oru direction-la irukkum, loop varadhu.
4. **Governs** — "Depends on"-oda opposite — idhu vera edha rules-a control pannudhu.
5. **Lifecycle** — Idhu edha lifecycle-a (Student, Attendance record, Position, etc.) read/write/gate pannudhu. Apply aagalana `—`.
6. **Workflow** — Approval obligation: `None`, `Direct write`, illa workflow entity type + approval floor.
7. **AI** — AI authority implication: L1 / L2 / L3 / Prohibited / `—`.
8. **Modules** — Andha rule-a use pannra delivery modules (numbers-a).
9. **Data effect** — Rule data-a **create** pannudha, **supersede** (correction maadhiri, original preserve pannitu new value effective aagardhu) pannudha, illa **preserve** (edhume mathamatadhu) pannudha.
10. **Implementation** — Real code, table, route, migration surface — actual-a evvidam implement panniirukanga nu.
11. **Conformance** — 4 states-la edhu — §6-la detail-a paakalam.
12. **Decisions** — Idha create/amend panna Decision Ledger entries.

---

## 6. Conformance States — Rule Yekku Code-oda Match Aagudha nu Check

- **Conformant** = Implementation rule-oda match aagudhu, test-um pass aagirukku. Obligation: maintain pannunga.
- **Divergent** = Implementation exist pannudhu, aana rule-a contradict pannudhu (code wrong-a irukku). Obligation: code fix pannanum, Implementation Impact Matrix-la track pannuvaanga.
- **Not built** = Rule decide aagirukku, aana implementation edhуவும் illa innum. Obligation: schedule pannunga.
- **Undecided** = Oru dependent decision genuinely open-a irukku — rule constraint-a state pannudhu, aana resolution-a illa. Obligation: dependent work start pannradhukku munnaadi resolve pannanum.

**Mukkiyamana point**: Divergent/Undecided nu state, adhu **implementation-oda** illa **decision-oda** property — **rule** oda property illa. Rule text eppozhudhume normative-a, timeless-a irukkum, code correct-a irundhaalum, illandhaalum.

---

## 7. Amendment Procedure — Rule Change Panna Real Steps

Oru rule-a change pannanumna, idhu 6-step process:

1. **Decision-a record pannunga.** Decision Ledger-la oru entry open pannanum — rationale (yen change pannuranga), affected artefacts, migration impact, implementation notes ella-oda.
2. **Exactly oru rule-a mattum amend pannunga.** Andha statement-a own pannra single RS-* record-a edit pannanum. Andha statement vera edhavadhu file-la kooda irundha, adhu oru defect — adha cross-reference-a maathanum.
3. **Dependency edges-a update pannunga.** Affected `Depends on`/`Governs` edges rendu side-layum update pannanum.
4. **Derived views-a regenerate pannunga.** `20-matrices/`-la irukra matrices auto-derived — idhu same change-la update aagum, separate-a illa.
5. **Validate pannunga.** `python tools/validate.py` kandippa pass aagunum — unique identifiers, ella cross-references resolve aagardhu, orphaned rules illama, duplicate normative statements illama, symmetric dependency edges.
6. **Publish pannunga.** Markdown-thaan source of truth. PDF, DOCX generated artefacts (`tools/export.sh` vachi) — adha directly edit panna koodaadhu.

---

## 8. Cross-Reference Convention — Vera Rule-a Eppadi Refer Pannanum

Oru rule vera oru rule-a refer panna vendina, fixed format use pannanum:

| Reference Type | Format |
|---|---|
| Rule | `[RS-ATT-004](../10-specification/RS-ATT-attendance.md#rs-att-004)` |
| Decision Ledger entry | `[ADL-007](../30-decisions/ledger.md#adl-007)` |
| Architecture Decision Record | `[ADR-021](../30-decisions/adr-register.md#adr-021)` |
| Matrix | `[Lifecycle Matrix](../20-matrices/lifecycle-matrix.md)` |

Idhu mukkiyamana rule oru irukku: **oru rule-oda content-a vera oru place-la plain-a repeat panna koodaadhu.** Oru rule vera oru rule-oda subject-a *name* panna mudiyum (refer panna), aana adha *restate* panna koodaadhu (mudhal content-a thirumba solla koodaadhu). Idhu yen important na — same statement rendu place-la irundha, edhu correct-nu confusion varum, oru place update pannina innoru place old-a remain aagum.

---

## Kandupudichadhu / Findings

Idhu document-a full-a padichadhukku appuram kandupudichadha ella inconsistencies-um idhu:

1. **Domain codes table-la 3 domains missing** — `scope-and-conventions.md` §4 table-la 14 domains mattum list pannirukanga (GOV, TEN, IDN, STF, CLS, ACA, ATT, STU, FIN, ASM, WFL, NTF, AIG, DAT). Aana real-a `10-specification/` folder-la **17 files** irukku. RS-ADM (admission wizard, 4 rules), RS-ANL (analytics governance, 4 rules), RS-PRF (personal workspace, 3 rules) — moondrும் real content-oda, real rules-oda irukku (idhu ella `index.md`-lла kооda officially list panniyirukanga, "Total: 163 rules" nu). Aana `scope-and-conventions.md`-oda domain codes table adha update pannala. Idhu already-flagged known defect-nu solli irukanga.

2. **RS-GOV file-la 17 rules irukku, aana `index.md`-la "14" nu declare pannirukanga.** `10-specification/index.md`-la RS-GOV row-la "14" nu rules count kudukkirukanga, aana `RS-GOV-governance.md` file-a paathaal athula RS-GOV-001 la irundhu RS-GOV-017 varaikkum **17 rules** irukku (RS-GOV-015, 016, 017 kooda recent additions-a irukku — license/trial, principal invitation, onboarding wizard fields pathi). Idhu index count vs real file count-la mismatch.

3. **RS-STF file-la 15 rules irukku, aana `index.md`-la "13" nu irukku.** `RS-STF-staff.md`-la RS-STF-001 la irundhu RS-STF-015 varaikkum irukku (14, 15 kooda irukku — mobile OTP, staff directory), aana index "13" nu solrudhu.

4. **RS-CLS file-la 13 rules irukku, index-um "13" nu solrudhu** — idhu match aagudhu, correct-a irukku.

5. **RS-ASM file-la 12 rules irukku, aana `index.md`-la "10" nu irukku.** RS-ASM-011 (storage quota) mattrum RS-ASM-012 (assessment type authoring) recent additions, index count old-a irukku pola.

6. **Total rule count verify pannradhu difficult** — `index.md`-la "Total: 163 rules" nu claim pannirukanga, aana individual domain counts (mேலே sonna maadhiri) real file content-oda match aagala — so intha "163" total-um accurate-ah nu doubt varudhu, verify panna vேணும்.

7. **Cross-reference structurally correct-a irundhachu** — naan padichа 17 files-la irundhu, out-of-scope table-la kudutha 7 rule IDs (RS-FIN-001, RS-ASM-009, RS-ATT-007, RS-STU-012, RS-ASM-001, RS-AIG-014, RS-IDN-013) ella-um real-a exist pannudhu, adhoda content-um solra reasoning-oda match aagudhu — idhula broken link edhuvum kaanala.

8. **RS-GOV-014-la self-correction irukku** — "Corrected 2026-08-16" nu, munnadi "L2 never has its own login" nu wrong-a documented panniyirundhadhu, real code-la already L2 login exist pannudhu nu kandupidichи fix pannirukanga (ADL-034). Idhu spec-oda self-correcting nature-a kaatudhu, aana idhu kூட ஒரு point — spec matham code-oda drift aagi, appuram correct pannirukanga.

9. **Scope-and-conventions.md itself version/date illama irukku** — "Status: Normative" nu mattum irukku, aana andha document last update aana date kudukkala, so §4 table eppo stale aachu nu trace panna mudiyala.

---

*Idhu document `/mnt/user-data/uploads/bka/00-foundation/scope-and-conventions.md` mattrum adhu reference pannra 17 `10-specification/` files ella-yum full-a padichi vachu eludhapattadhu.*
