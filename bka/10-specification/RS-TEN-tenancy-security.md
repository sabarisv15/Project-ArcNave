# RS-TEN — Multi-Tenancy, Isolation & Layering

**Domain:** Tenant isolation, platform separation, structural layering
invariants, authentication.
**Owning services:** Tenant Middleware, `PlatformService`, all services
(layering invariants).

---

## RS-TEN-001

**Every tenant-scoped query is protected by PostgreSQL Row-Level Security, not
by application-level filtering alone.**

Application-level filtering (`WHERE college_id = …`) is a convention, not a
guarantee: one missed clause anywhere leaks one college's data to another. RLS
makes the wrong query physically incapable of returning another tenant's rows.
Tenant Middleware is the first line; RLS is the backstop.

**Release gate.** An automated integration test that runs two tenants' requests
on the same pooled connection and asserts tenant B can never see tenant A's rows
MUST pass before any module touching tenant data ships. This is a gate, not a
nice-to-have, and it is re-run after every group of changes touching identity or
tenant data.

| | |
|---|---|
| **Owner** | Tenant Isolation |
| **Supporting Components** | Data layer, Tenant Middleware |
| **Authority** | System invariant |
| **Depends on** | [RS-TEN-002](RS-TEN-tenancy-security.md#rs-ten-002), [RS-TEN-003](RS-TEN-tenancy-security.md#rs-ten-003) |
| **Governs** | [RS-TEN-004](RS-TEN-tenancy-security.md#rs-ten-004), [RS-IDN-002](RS-IDN-identity.md#rs-idn-002), [RS-STU-001](RS-STU-students.md#rs-stu-001), [RS-AIG-016](RS-AIG-ai-governance.md#rs-aig-016), [RS-PRF-001](RS-PRF-personal-workspace.md#rs-prf-001), [RS-PRF-003](RS-PRF-personal-workspace.md#rs-prf-003) |
| **Lifecycle** | — |
| **Workflow** | — |
| **AI** | Applies unchanged to every AI tool |
| **Modules** | 0 and all |
| **Data effect** | — |
| **Implementation** | RLS policy + `FORCE ROW LEVEL SECURITY` on every tenant table; `tests/rls-tenant-isolation.test.js` |
| **Conformance** | Conformant |
| **Decisions** | [ADR-002](../30-decisions/adr-register.md#adr-002) |

---

## RS-TEN-002

**Tenant context is established with `SET LOCAL app.current_tenant` inside
every request transaction, never as a bare connection-level `SET`.**

A pooled connection that sets tenant context and returns to the pool without
resetting leaks that context into the next request reusing it. `SET LOCAL` is
scoped to the transaction and resets automatically when it ends, regardless of
commit or rollback.

Middleware order is fixed: auth → tenant resolution → request logging → begin
transaction → `SET LOCAL` → route handler.

| | |
|---|---|
| **Owner** | Tenant Middleware |
| **Authority** | System invariant |
| **Depends on** | [RS-TEN-005](RS-TEN-tenancy-security.md#rs-ten-005) |
| **Governs** | [RS-TEN-001](RS-TEN-tenancy-security.md#rs-ten-001) |
| **Lifecycle** | — |
| **Workflow** | — |
| **AI** | — |
| **Modules** | 0 |
| **Data effect** | — |
| **Implementation** | `middleware/tenant.js`; `set_config('app.current_tenant', …, true)` |
| **Conformance** | Conformant |
| **Decisions** | [ADR-002](../30-decisions/adr-register.md#adr-002) |

---

## RS-TEN-003

**The database role that runs migrations and the role the application connects
as are always different roles.**

The migration role owns every table. The runtime application role owns nothing,
is never granted `SUPERUSER`, and is never made the owner of any tenant table.
Two distinct connection strings are wired for the two purposes and MUST NOT be
pointed at the same role, even for local-development convenience.

PostgreSQL RLS has two independent bypasses. `FORCE ROW LEVEL SECURITY` closes
the table-owner bypass; nothing closes the superuser bypass. The only thing
that actually protects tenant data from a misbehaving query is that the running
application never uses a superuser or owning role.

Every new tenant table added by a future migration MUST explicitly `GRANT` only
the subset of privileges the runtime role actually needs. There is no ownership
shortcut that grants this for free.

| | |
|---|---|
| **Owner** | Data layer |
| **Authority** | System invariant |
| **Depends on** | — |
| **Governs** | [RS-TEN-001](RS-TEN-tenancy-security.md#rs-ten-001), [RS-DAT-006](RS-DAT-data-integrity.md#rs-dat-006), [RS-DAT-007](RS-DAT-data-integrity.md#rs-dat-007) |
| **Lifecycle** | — |
| **Workflow** | — |
| **AI** | — |
| **Modules** | 0 |
| **Data effect** | — |
| **Implementation** | `arcnave_admin` / `arcnave_app` / `arcnave_platform`; `MIGRATION_DATABASE_URL` vs `DATABASE_URL` |
| **Conformance** | Conformant |
| **Decisions** | [ADR-015](../30-decisions/adr-register.md#adr-015) |

---

## RS-TEN-004

**Platform Admin is the only actor that sits entirely outside every tenant's
RBAC model, and operates through a completely separate application.**

Platform Admin is not a role inside any tenant's `users` table and never
executes inside the RLS-scoped tenant path via ordinary tenant auth. Making
Platform Admin "just another role" would require either weakening RLS with a
bypass baked into every query, or accepting that one role quietly breaks the
isolation model everything else depends on.

Platform Admin has no standing access-request path into a live college's
configuration; the only exceptions are the key-gated structural actions
([RS-GOV-005](RS-GOV-governance.md#rs-gov-005)).

| | |
|---|---|
| **Owner** | `PlatformService` |
| **Authority** | ARCNAVE |
| **Depends on** | [RS-TEN-001](RS-TEN-tenancy-security.md#rs-ten-001) |
| **Governs** | [RS-GOV-001](RS-GOV-governance.md#rs-gov-001), [RS-GOV-005](RS-GOV-governance.md#rs-gov-005) |
| **Lifecycle** | Organization |
| **Workflow** | — |
| **AI** | Prohibited — no path into the tenant AI Workspace exists |
| **Modules** | 0 |
| **Data effect** | — |
| **Implementation** | Separate Platform API and auth; `admin.arcnave.com` vs `<college>.arcnave.com` |
| **Conformance** | Conformant |
| **Decisions** | [ADR-010](../30-decisions/adr-register.md#adr-010), [ADL-001](../30-decisions/ledger.md#adl-001) |

---

## RS-TEN-005

**Tenant resolution follows a fixed candidate order with conflict-is-a-reject
semantics: subdomain, then JWT claim, then explicit college code at login.**

No single resolution source is a point of failure. Each college is provisioned
a subdomain via wildcard DNS and wildcard TLS. Branded custom domains are not
provided; a future custom-domain capability would add a genuinely new
resolution source rather than extend subdomain parsing.

| | |
|---|---|
| **Owner** | Tenant Middleware |
| **Authority** | System invariant |
| **Depends on** | — |
| **Governs** | [RS-TEN-002](RS-TEN-tenancy-security.md#rs-ten-002) |
| **Lifecycle** | — |
| **Workflow** | — |
| **AI** | — |
| **Modules** | 0 |
| **Data effect** | — |
| **Implementation** | `middleware/tenant.js`; `colleges.subdomain` unique at DB level |
| **Conformance** | Conformant |
| **Decisions** | [ADR-013](../30-decisions/adr-register.md#adr-013) |

---

## RS-TEN-006

**The Business Services layer is the single place business logic lives; every
consumer calls through it, and nothing else reaches a repository or the
database.**

Web routes, mobile API calls and AI tools alike call Business Services. A
second source of truth for a rule — logic living in a route, a tool wrapper or
a repository — is a structural defect regardless of whether it currently
behaves correctly.

| | |
|---|---|
| **Owner** | All services |
| **Authority** | System invariant |
| **Depends on** | — |
| **Governs** | [RS-TEN-007](RS-TEN-tenancy-security.md#rs-ten-007), [RS-ASM-005](RS-ASM-assessment-documents.md#rs-asm-005), [RS-AIG-002](RS-AIG-ai-governance.md#rs-aig-002) |
| **Lifecycle** | — |
| **Workflow** | — |
| **AI** | Binding on every AI tool |
| **Modules** | All |
| **Data effect** | — |
| **Implementation** | `services/` layer |
| **Conformance** | Conformant |
| **Decisions** | [ADR-003](../30-decisions/adr-register.md#adr-003) |

---

## RS-TEN-007

**Repositories own query mechanics only, never call other repositories, and no
raw SQL exists outside a repository.**

Services own business logic; repositories own query mechanics. The sole
exception to the raw-SQL prohibition is transaction control
(`BEGIN`/`COMMIT`/`ROLLBACK`) and tenant-context bootstrap, which run around or
before repository-mediated business queries rather than replacing them.

Cross-cutting append-only ledgers (`audit_log`, `generated_reports`) are exempt
from the "one repository per domain service" pairing: any service calls them
directly, because they are event ledgers rather than a business domain any
service owns.

| | |
|---|---|
| **Owner** | Repository layer |
| **Authority** | System invariant |
| **Depends on** | [RS-TEN-006](RS-TEN-tenancy-security.md#rs-ten-006) |
| **Governs** | [RS-DAT-006](RS-DAT-data-integrity.md#rs-dat-006), [RS-AIG-002](RS-AIG-ai-governance.md#rs-aig-002) |
| **Lifecycle** | — |
| **Workflow** | — |
| **AI** | AI tools MUST NOT reach a repository, storage or raw SQL |
| **Modules** | All |
| **Data effect** | — |
| **Implementation** | `repositories/`; documented exceptions in `middleware/tenant.js`, `backgroundJobService.js` |
| **Conformance** | Conformant |
| **Decisions** | [ADR-018](../30-decisions/adr-register.md#adr-018) |

---

## RS-TEN-008

**A user MAY hold multiple concurrent sessions across devices; MFA is
configurable per institution and MAY be scoped to specific roles.**

Logging in on one device does not terminate another session. MFA settings are
`Disabled`, `Optional` or `Mandatory`. AI operates only after successful
authentication and can never bypass, disable or weaken MFA.

Position Account MFA enrollment is columns-only: the schema carries the state,
no enrollment flow exists yet.

| | |
|---|---|
| **Owner** | Authentication & Session Policy |
| **Supporting Components** | `AuthService`, `ConfigurationService` |
| **Authority** | L1 configures; system enforces |
| **Depends on** | [RS-IDN-009](RS-IDN-identity.md#rs-idn-009) |
| **Governs** | [RS-AIG-016](RS-AIG-ai-governance.md#rs-aig-016) |
| **Lifecycle** | Session |
| **Workflow** | None — L1 configuration |
| **AI** | Prohibited from altering |
| **Modules** | 0 |
| **Data effect** | — |
| **Implementation** | **Stage 8e (2026-07-26):** Position Account MFA enrollment built — `position_account_mfa_otps` table (mirrors `user_mfa_otps`), `positionAccountAuthService.login` now gates into an email-OTP challenge using the SAME `configurations` category `auth` (mfaMode/mfaRoles) personal-user login already reads, role-scoped via `identityService.deriveEffectiveRoleAndScopeForPosition`. Self-service `POST /position-accounts/mfa/enable`\|`disable`, challenge completion via `POST /position-accounts/mfa/verify` — mirrors `/auth/mfa/*` exactly. `position_accounts.mfa_secret` (TOTP) stays unused; email-OTP reuses the existing, already-live mechanism rather than a new one. |
| **Conformance** | Conformant |
| **Decisions** | [ADR-024](../30-decisions/adr-register.md#adr-024) |
