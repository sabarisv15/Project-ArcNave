'use strict';

// Module 9 (AI) — shared data-classification-access matrix. Originally
// inline in aiToolRegistry.js's own Policy Gate (see ADR-020); pulled
// out into its own module because the RAG slice's search_documents
// tool needs the identical role -> classification mapping for a
// SECOND, independent purpose: per-ROW filtering of retrieved document
// chunks inside documentSearchService.searchDocuments, not just the
// Policy Gate's single tool-level classification check
// (AI-Governance.md §4: "action level and data classification are two
// independent checks" — this extends that same reasoning to ROWS
// within one tool call, not just tools themselves). Both callers
// import the one table here rather than each keeping their own copy
// that could silently drift apart.
//
// Conservative default, not sourced from BusinessRules.md (which does
// not yet define an AI-actor/data-classification matrix) — still
// Proposed, not settled; see ADR-020.
// class_tutor (Institutional, Phase 3) reads at the same tier as staff
// — the tools it is granted (aiToolRegistry.js's own audit) are all
// Internal classification. level2 gets no entry: it is not currently
// granted any tool (see Phase3-AI-Identity-Context-Integration.md
// step 3's own guidance — Level 2's scope-configuration policy is
// still undecided per ADR-021, so no classification is granted
// speculatively either); permittedClassifications(role) already
// fails closed to [] for any role with no entry here.
const ROLE_CLASSIFICATION_ACCESS = {
  principal: ['Internal', 'Confidential', 'Restricted'],
  hod: ['Internal', 'Confidential'],
  staff: ['Internal'],
  class_tutor: ['Internal'],
};

// An unrecognized role gets no classifications at all, not every
// classification — the same fail-closed default the Policy Gate's own
// assertPolicyAllows already relies on via `|| []`.
function permittedClassifications(role) {
  return ROLE_CLASSIFICATION_ACCESS[role] || [];
}

module.exports = { ROLE_CLASSIFICATION_ACCESS, permittedClassifications };
