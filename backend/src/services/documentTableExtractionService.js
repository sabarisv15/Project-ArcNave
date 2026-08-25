'use strict';

// Structural-only table/row extraction over an already-extracted document's
// plain text (documentTextExtractionService's output) — the "Common
// Document Representation" layer from ADR-029. Deliberately carries no
// semantic field meaning (no "column 3 is a register number"): it only
// ever produces rows/cells or raw text blocks keyed by a record identifier.
// Per-question column meaning is resolved by the caller (the LLM, via
// documentAggregateService's params), never pre-learned or cached here —
// see ADR-029's "why structural-only, not semantic CDR" section.
//
// Two detector strategies, chosen by what the input text looks like — not
// a per-document-family branch. More strategies get added here as new real
// document families are encountered (ADR-029's incremental-build
// principle); this file's shape (detect -> records[]) doesn't change when
// they do.

// documentTextExtractionService's XLSX/ODS extractors already join a row's
// cells with ' | ' (extractXlsxText/extractOdsText) — genuinely delimited,
// safe to split on directly. Any text containing this marker is treated as
// pre-delimited tabular text, regardless of which extractor produced it.
const DELIMITER = ' | ';

// A tab is admitted as a second delimiter; a comma deliberately is NOT.
// Commas are ordinary punctuation in prose, so splitting on them would
// misread any ordinary document as a table, and real CSV needs quote
// handling a line split cannot do anyway — text/csv is instead parsed
// properly upstream by documentTextExtractionService and arrives here
// already joined with DELIMITER above. Tabs carry no such ambiguity: they
// are rare in prose and are what a genuinely tab-separated export uses.
const TAB_DELIMITER = '\t';

// A tab-separated table has a consistent shape; a prose document that
// happens to contain a few tabs does not. Three conditions, all required,
// and all relative to the document's own line counts rather than to any
// absolute constant:
//   - a line only counts as tabular if every one of its cells has content.
//     A delimiter separates content from content; a tab used to INDENT
//     separates nothing from content, and leaves an empty leading cell.
//     Without this, a ragged indented list reads as a consistent 2-column
//     table, because "<tab>one" and "<tab>five" genuinely do agree on a
//     column count — caught by a test written to fail this rule.
//   - those lines must be a majority of the non-empty lines
//   - a majority of them must agree on the SAME column count (>= 2)
//
// The trade-off is deliberate: a genuine TSV in which most rows have a
// blank cell will not be detected. Under-detecting leaves today's
// behaviour (strategy 'none' — an honest failure); over-detecting would
// misread prose as a table, which is the failure mode this whole slice
// exists to remove.
function tabCells(line) {
  return line.split(TAB_DELIMITER).map((cell) => cell.trim());
}

function isFullyPopulatedTabLine(line) {
  if (!line.includes(TAB_DELIMITER)) return false;
  return tabCells(line).every((cell) => cell !== '');
}

function looksTabDelimited(lines) {
  const nonEmpty = lines.filter((line) => line.trim() !== '');
  if (nonEmpty.length === 0) return false;
  const tabbed = nonEmpty.filter(isFullyPopulatedTabLine);
  if (tabbed.length * 2 <= nonEmpty.length) return false;

  const counts = new Map();
  tabbed.forEach((line) => {
    const n = tabCells(line).length;
    counts.set(n, (counts.get(n) || 0) + 1);
  });
  let modalCount = 0;
  let modalFrequency = 0;
  counts.forEach((frequency, n) => {
    if (frequency > modalFrequency) { modalFrequency = frequency; modalCount = n; }
  });
  return modalCount >= 2 && modalFrequency * 2 > tabbed.length;
}

function splitOn(text, delimiter) {
  return text
    .split('\n')
    .filter((line) => line.includes(delimiter))
    .map((line) => ({ key: null, cells: line.split(delimiter).map((c) => c.trim()) }));
}

function extractDelimitedRows(text) {
  const rows = splitOn(text, DELIMITER);
  if (rows.length > 0) return rows;
  if (looksTabDelimited(text.split('\n'))) return splitOn(text, TAB_DELIMITER);
  return [];
}

// Roster-style detector — a line starting with a short serial number
// followed by a longer id/registration number marks the start of a new
// record (e.g. "819 25400122 ANBARASAN V ..."). This shape is common to
// any serial-numbered roster (attendance, fee, staff lists), not specific
// to examination result-sheets — but it is one specific shape, not every
// conceivable tabular layout; documents that don't start rows this way
// fall through to STRATEGY_NONE below rather than being force-fit.
const RECORD_START_PATTERN = /^(\d{1,5})\s+(\d{5,12})\b/;

// A section header's own subject/course-percentage summary table (see
// SECTION_HEADER_PATTERN below) is laid out identically to a real student
// row by pure shape — "<short number> <long digit code> <ALL-CAPS text>"
// (e.g. "1 1040234210 DATA COMMUNICATION AND NETWORKING T 6 6 100") — so
// RECORD_START_PATTERN alone false-matches it; digit COUNT alone can't
// tell a subject code from a registration number without hardcoding one
// college's specific regNo length, which would silently misfire on a
// different real institution's document. A genuine student row instead
// always carries at least one of these two content markers somewhere in
// its own span (never both missing) — a DoB, or a semester/regulation-
// year marker (see SEMESTER_MARKER_PATTERN in documentAggregateService.js,
// same convention) — while a subject-summary row carries neither. Live-
// verified against a real 300+ page consolidated result sheet before
// shipping: this signal keeps all 1781 genuine student rows and rejects
// exactly the 130 subject/course-summary rows that would otherwise have
// silently inflated a section's record count (e.g. "50 Sandwich records"
// when only 41 were real students).
const STUDENT_ROW_SIGNAL_PATTERN = /\bDoB\s*:|\b\d{1,2}\s+R\d{4}\b/i;

// The subset of STUDENT_ROW_SIGNAL_PATTERN that occurs AT MOST ONCE per
// real record, which is what makes it usable for counting rather than just
// recognizing. A date of birth is one per person by construction; the
// semester/regulation alternative above is NOT — a single student's span
// carries one per subject attempt — so only this half can be used to check
// whether the detector accounted for every row it should have. See
// assessCoverage below for what that check is and why it exists.
const RECORD_IDENTITY_MARKER = /\bDoB\s*:/gi;

function countMarkers(text) {
  const matches = text.match(RECORD_IDENTITY_MARKER);
  return matches ? matches.length : 0;
}

// Does this record set actually account for the rows in the source text?
//
// RECORD_START_PATTERN recognizing SOMETHING is not the same as recognizing
// it CORRECTLY, and the gap between those two is not theoretical: a real
// exam-fees PDF whose printed table uses merged cells extracts to text
// whose columns are interleaved out of reading order, and this detector
// produced 4 records for a 23-student document — while
// documentAnalysisService, which only ever guarded strategy 'none',
// reported status 'ok' with a confident total over those 4. A silently
// wrong deterministic answer is worse than an honest refusal, and it also
// slips past verifyNumericClaims, which compares the narration to the tool
// output and never the tool output to the document.
//
// The check is the detector's own contract turned around: every identity
// marker in the text must be accounted for, either as its own record or as
// one of the page-break continuations this file merged deliberately just
// above. Two distinct ways that can fail, both real:
//   orphanCount     - markers that landed in no record at all (rows missed)
//   collapsedRecords- a record holding more markers than the number of
//                     fragments merged into it (several rows swallowed
//                     into one)
// Deliberately NOT a tuned threshold — the comparison is against the
// document's own marker count and this file's own merge count, so there is
// no per-document constant to get wrong on the next layout. Measured
// against the two real documents available: the 300+ page consolidated
// result sheet balances exactly (1425 single-marker records + 178
// two-marker records = 1781 = its marker count, and those 178 are exactly
// the 178 page-break merges), while the exam-fees PDF accounts for 17 of
// 23 markers and puts 10 of them in one record.
//
// applicable=false when the text carries no identity marker at all: a
// document whose rows don't print a DoB gives no signal either way, and
// "no signal" must mean "no judgement", never a refusal. That is a real
// limitation of this check, not a gap to paper over with a guess.
function assessCoverage(text, records, fragmentCounts) {
  const markerCount = countMarkers(text);
  if (markerCount === 0) {
    return {
      applicable: false, reliable: true, markerCount: 0, accountedCount: 0, orphanCount: 0, collapsedRecords: 0,
    };
  }
  let accountedCount = 0;
  let collapsedRecords = 0;
  records.forEach((record, i) => {
    const inBlock = countMarkers(record.block);
    accountedCount += inBlock;
    if (inBlock > fragmentCounts[i]) collapsedRecords += 1;
  });
  const orphanCount = markerCount - accountedCount;
  return {
    applicable: true,
    reliable: orphanCount === 0 && collapsedRecords === 0,
    markerCount,
    accountedCount,
    orphanCount,
    collapsedRecords,
  };
}

// A PDF/DOCX text extraction has no reliable column delimiter (verified
// against a real result-sheet PDF this session — pdf-parse's default
// getText() joins cell text with plain spaces, indistinguishable from a
// sentence's own word-spacing). Records are therefore kept as raw text
// blocks (all lines between one record-start and the next), not split into
// cells — documentAggregateService counts pattern matches within the block
// text instead of addressing a specific column.
function extractSequentialIdRecords(text) {
  const lines = text.split('\n');
  const candidates = [];
  lines.forEach((line, i) => {
    const m = RECORD_START_PATTERN.exec(line);
    if (m) candidates.push({ index: i, serialNo: m[1], regNo: m[2] });
  });
  if (candidates.length === 0) return null;

  // Reject a candidate whose own span up to the next candidate never
  // shows STUDENT_ROW_SIGNAL_PATTERN — see that constant's own comment.
  // Checked against candidate-to-candidate spans (not yet-filtered
  // survivor-to-survivor spans): in every real document seen so far a
  // subject-summary run and the real student rows are physically separate
  // sections, never interleaved, so this is equivalent and simpler; if a
  // future document interleaves them, that's a new case to handle when
  // it's actually encountered, not one to guess a fix for now.
  const starts = candidates.filter((candidate, i) => {
    const endIndex = i + 1 < candidates.length ? candidates[i + 1].index : lines.length;
    const span = lines.slice(candidate.index, endIndex).join('\n');
    return STUDENT_ROW_SIGNAL_PATTERN.test(span);
  });
  if (starts.length === 0) return null;

  const records = starts.map((start, i) => {
    const endIndex = i + 1 < starts.length ? starts[i + 1].index : lines.length;
    return {
      key: `${start.serialNo}:${start.regNo}`,
      serialNo: start.serialNo,
      regNo: start.regNo,
      // The line this record starts at — not exposed to the LLM, used
      // only by detectSections/documentAnalysisService.filterBySection
      // below to work out which course/section a record falls under by
      // position, since section headers and student rows share the same
      // line-numbered coordinate space.
      startLine: start.index,
      block: lines.slice(start.index, endIndex).join('\n'),
    };
  });

  // Page-break continuation: a record's row is sometimes re-printed at the
  // top of the next physical page to continue the same student's
  // remaining rows (verified against real serial numbers 822/827/847 in
  // this session's source document) — merge immediately-consecutive
  // records sharing the same key rather than treating the repeat as a new
  // record.
  // fragmentCounts is kept alongside rather than on the records themselves
  // so it never reaches a caller (and, through documentAggregateService's
  // bounded sample, an LLM prompt) as if it were document content — it is
  // this detector's own bookkeeping, used only by assessCoverage.
  const merged = [];
  const fragmentCounts = [];
  for (const record of records) {
    const prev = merged[merged.length - 1];
    if (prev && prev.key === record.key) {
      prev.block += `\n${record.block}`;
      fragmentCounts[fragmentCounts.length - 1] += 1;
    } else {
      merged.push({ ...record });
      fragmentCounts.push(1);
    }
  }
  return { records: merged, fragmentCounts };
}

// Section/course header detection — DTE-style consolidated result sheets
// repeat one header line per printed page naming the course code/name
// every record on that page belongs to (e.g. "111 GOVERNMENT POLYTECHNIC
// COLLEGE, COIMBATORE 2040 ELECTRONICS AND COMMUNICATION ENGINEERING
// (SANDWICH) 2 24"). Detecting these lets a caller scope analysis by
// course/section NAME (e.g. "Sandwich") instead of requiring a numeric
// serial range it doesn't already know — the real gap a live comparison
// against a direct Gemini upload surfaced: the same document has a
// genuinely separate "ECE (SANDWICH)" cohort at a serial range nowhere
// near the "ECE (FULL TIME)" one, and there was no way to ask for it by
// name. Verified live against a real 300+ page consolidated result sheet
// before shipping: 317 raw header-line occurrences (one per page)
// collapse to exactly 10 distinct real sections. Still a plain string
// match against existing document text, never a semantic mapping this
// service invents — the caller supplies which section name they mean.
const SECTION_HEADER_PATTERN = /\b\d{3,4}\s+[A-Z][A-Z .,&'()/-]{8,120}\((?:FULL TIME|SANDWICH|PART TIME|LATERAL ENTRY)\)/;

// One entry per section CHANGE, not one per page — the header line
// repeats every page within the same section, so only the first
// occurrence after the section actually changes is a real boundary.
// { courseName, startLine }[], in document order — startLine lines up
// with extractSequentialIdRecords' own record.startLine.
function detectSections(lines) {
  const sections = [];
  lines.forEach((line, i) => {
    const m = SECTION_HEADER_PATTERN.exec(line);
    if (!m) return;
    const courseName = m[0];
    const prev = sections[sections.length - 1];
    if (!prev || prev.courseName !== courseName) {
      sections.push({ courseName, startLine: i });
    }
  });
  return sections;
}

// text: documentTextExtractionService's already-extracted plain text.
// Returns { strategy, records, sections } — records are either { key,
// cells } (a genuinely delimited source) or { key, serialNo, regNo,
// startLine, block } (a sequential-id roster detected in free text).
// sections is only ever non-empty for the sequential_id strategy — a
// delimited source (XLSX/ODS) has no printed page headers to detect.
// Returns strategy: 'none' with empty records/sections when neither
// detector recognizes the text — callers must treat that as "not a
// recognized tabular layout," never guess a record shape.
function extractRecords(text) {
  if (typeof text !== 'string' || text.length === 0) {
    return { strategy: 'none', records: [], sections: [], coverage: null };
  }

  const delimited = extractDelimitedRows(text);
  if (delimited.length > 0) {
    // coverage: null, not a passing assessment — the delimited strategy is
    // exact by construction (one input line, one row, nothing inferred), so
    // there is nothing for a coverage check to be uncertain about. Running
    // one here would invent a failure mode this strategy doesn't have.
    return { strategy: 'delimited', records: delimited, sections: [], coverage: null };
  }

  const sequential = extractSequentialIdRecords(text);
  if (sequential) {
    return {
      strategy: 'sequential_id',
      records: sequential.records,
      sections: detectSections(text.split('\n')),
      coverage: assessCoverage(text, sequential.records, sequential.fragmentCounts),
    };
  }

  return { strategy: 'none', records: [], sections: [], coverage: null };
}

module.exports = { extractRecords };
