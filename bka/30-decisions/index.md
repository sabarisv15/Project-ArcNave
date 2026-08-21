# Decisions

**Status:** Historical record.

---

Two registers live here, with a strict division of responsibility.

| Register | Answers | Binding for |
|---|---|---|
| [Architecture Decision Ledger](ledger.md) | *How did this rule come to be true?* Every resolved conflict, superseded position and open decision | Rationale and migration obligation |
| [ADR Register](adr-register.md) | *Why was this technical choice made, and when is it revisited?* | Technical rationale and revisit triggers |

Neither is binding for current-state rule text. That is the exclusive province
of the [Specification layer](../10-specification/index.md).

## Why the separation exists

The specification is written to be **timeless**. It contains no "corrected on",
"previously", "reversal of" or dated-session language, because a rule that
carries its own history invites the reader to reason about which version
applies. Complete architectural traceability is preserved — but here, where it
cannot contaminate the normative text.

## Open decisions

Three items are genuinely open. Two of them gate other work.

| ID | Subject | Gating effect |
|---|---|---|
| [ADL-021](ledger.md#adl-021) | Position level integer versus business L-number | **Blocks all identity-layer work.** Every subsequent migration inherits the choice |
| [ADL-020](ledger.md#adl-020) | AI downstream scope fidelity | **Highest severity.** A possible live authorization-fidelity defect; verify against code before other scheduled work |
| [ADL-005](ledger.md#adl-005) | Role-to-classification matrix ratification | Non-blocking. Awaits real production exercise of the higher tiers |

## Governance obligations

1. **Every non-trivial or contested decision gets a record** with a status and,
   where relevant, a revisit trigger — never a decision left in chat history or
   a commit message.
2. **Deferred decisions are reviewed** after every completed major module, or
   quarterly, whichever comes first. A skipped review is a governance defect,
   because the review is the only mechanism preventing a deferred decision from
   rotting silently.
3. **Every rule amendment opens a ledger entry first**, before the rule text
   changes ([Conventions §7](../00-foundation/scope-and-conventions.md#7-amendment-procedure)).
