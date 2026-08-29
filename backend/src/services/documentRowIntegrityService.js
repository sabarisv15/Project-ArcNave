'use strict';

// Row-level value-integrity check for pdfplumber-reconstructed
// 'sequential_id' records — the still-open half of Review Finding #3
// (2026-08-29): documentTableExtractionService.assessCoverage proves every
// identity marker (DoB) is accounted for exactly once, never that the OTHER
// cell values in each row are attached to the right identity. This module
// is the "independent row-integrity check" documentAnalysisService's own
// comment names as the thing that would let a verified reconstruction earn
// full trust instead of staying capped at unreliable_extraction forever.
//
// GENERALIZED, not hand-fit (the fix note's own requirement): this file has
// no knowledge that a document has "fees" or "arrears" or that a rate is
// 65. It only knows how to (1) strip the substrings already structurally
// known to be non-value — a record's own serialNo/regNo, a DoB-shaped
// span, a semester/regulation marker — and (2) search increasing
// fixed-width numeric prefixes for an arithmetic relation (scaling or
// summation) that holds EXACTLY across every single record, using the
// widest prefix width still covered by every record. Measured against the
// real exam-fees PDF (backend/scripts/row-arithmetic-consistency-probe.js):
// a naive "match on the modal number-count" version degenerately passes by
// only testing the 9/23 all-zero rows and never touching the 14 rows that
// actually carry arrears — exactly the rows a misattribution defect would
// corrupt. The fixed-width-prefix version instead achieves 23/23 coverage
// and discovers two real, independent relations (fees = arrears * 65,
// total = fees + semFee) from the data alone, at widths 3 and 5
// respectively — the true document structure this probe was built to find
// without being told what it was.
//
// This module's scope is deliberately narrow: 'sequential_id' records only
// (the only strategy the pdfplumber fallback ever produces — see
// documentAnalysisService's PDFPLUMBER_RECONSTRUCT_SCRIPT comment on why
// cells are always rejoined with a single space, never '|' or a tab).
// 'delimited' records already carry real column boundaries and would need
// a different, more direct check if this were ever extended to them — not
// guessed at here before that case is actually encountered.

const DOB_SUBSTRING = /DoB\s*:?\s*[\d/.-]+/gi;
const SEMESTER_MARKER = /\b\d{1,2}\s+R\d{4}\b/gi;
const NUMBER_TOKEN = /-?\d+(?:\.\d+)?/g;

// A relation is only evidence if the positions it relates actually vary
// across the record set — crediting "column always reads 0" would make
// every all-zero column trivially "consistent" with anything.
function hasVariance(vectors, position) {
  const values = new Set(vectors.map((v) => v[position]));
  return values.size > 1;
}

function extractLeadingNumbers(record) {
  let { block } = record;
  if (record.serialNo) block = block.replace(record.serialNo, '');
  if (record.regNo) block = block.replace(record.regNo, '');
  block = block.replace(DOB_SUBSTRING, ' ').replace(SEMESTER_MARKER, ' ');
  const matches = block.match(NUMBER_TOKEN);
  return matches ? matches.map(Number) : [];
}

// Every discovered relation is checked against ALL vectors at this prefix
// width — not a sample, not a majority. One violation disqualifies it.
function discoverRelations(vectors, width) {
  const relations = [];
  for (let i = 0; i < width; i += 1) {
    for (let j = 0; j < width; j += 1) {
      if (i === j) continue;
      const base = vectors[0][i];
      if (base === 0) continue;
      const factor = vectors[0][j] / base;
      if (!Number.isInteger(factor) || factor === 0) continue;
      const holds = vectors.every((v) => v[j] === v[i] * factor);
      if (holds && (hasVariance(vectors, i) || hasVariance(vectors, j))) {
        relations.push({
          type: 'scale', from: i, to: j, factor,
        });
      }
    }
  }
  for (let i = 0; i < width; i += 1) {
    for (let j = i + 1; j < width; j += 1) {
      for (let k = 0; k < width; k += 1) {
        if (k === i || k === j) continue;
        const holds = vectors.every((v) => v[k] === v[i] + v[j]);
        if (holds && (hasVariance(vectors, i) || hasVariance(vectors, j) || hasVariance(vectors, k))) {
          relations.push({
            type: 'sum', addends: [i, j], total: k,
          });
        }
      }
    }
  }
  return relations;
}

// Below this many records, a "relation holding on every row" is too easily
// coincidence to stand behind — the real document this was measured
// against has 23. Kept as an explicit, named constant rather than an
// implicit assumption so the next real document that needs a different
// floor is a one-line change, not a rediscovery.
const MIN_RECORDS = 5;
// Two independent relations (one scaling, one summation, in the case this
// was measured against) is real structural evidence; a single relation is
// more plausibly a coincidence, especially a scaling relation with a small
// integer factor.
const MIN_RELATIONS = 2;
const MAX_PREFIX_WIDTH = 12;

// records: documentTableExtractionService's 'sequential_id' records
// ({ serialNo, regNo, block }[]). Returns { verified, relations, width } —
// verified is true only when every record was testable (100% coverage at
// the chosen width, never a majority) and at least MIN_RELATIONS distinct,
// non-trivial relations hold across all of them. Never throws: an
// unverifiable document is exactly as informative as one this check was
// never run against, so the caller falls back to today's existing
// behavior either way.
function assessRowIntegrity(records) {
  if (!Array.isArray(records) || records.length < MIN_RECORDS) {
    return { verified: false, relations: [], width: 0 };
  }

  const vectors = records.map(extractLeadingNumbers);
  let best = { verified: false, relations: [], width: 0 };

  for (let width = 2; width <= MAX_PREFIX_WIDTH; width += 1) {
    const covered = vectors.every((v) => v.length >= width);
    if (!covered) break; // widening further can only lose coverage, never regain it
    const prefixes = vectors.map((v) => v.slice(0, width));
    const relations = discoverRelations(prefixes, width);
    if (relations.length >= MIN_RELATIONS) {
      best = { verified: true, relations, width };
    }
  }

  return best;
}

module.exports = { assessRowIntegrity, MIN_RECORDS, MIN_RELATIONS };
