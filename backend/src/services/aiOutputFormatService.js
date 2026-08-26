'use strict';

// AI Output Format Policy — the ARCNAVE form of the consumer
// platform's layered "how I decide output format" framework.
//
// The framework's own closing principle is the part worth keeping:
// *the lightest format that fully serves the request; format only when
// it is earned.* Everything below is that principle made deterministic.
//
// WHY THIS IS A TOOL AND NOT PROMPT TEXT — read before "improving" it.
// The obvious implementation is a paragraph appended to the system
// instruction. That is specifically the change ADL-050 measured and
// rejected: altering how this same governance-bearing system
// instruction is packaged and delivered to Gemini measurably weakened a
// hard governance rule's compliance (category E, 3/3 → 2/7 live). The
// output-format question is a presentation preference; it is not worth
// spending any of that budget on. So the policy lives here, is
// deterministic and testable, and the model reaches it by asking.
//
// It is also the same lesson ADL-055's own thread reached three times:
// replacing a guess with a structural fact worked every time, asking
// the model to police itself in prompt text failed every time.
//
// LAYER MAPPING. The consumer framework's six layers do not survive
// intact, because two of them are answering questions ARCNAVE already
// answers elsewhere and more strictly:
//
//   Layer 0 (intent)          -> kept, as `shape` below
//   Layer 1 (inline vs file)  -> kept, but the destinations are
//                                ARCNAVE's: prose, artifact, document
//   Layer 2 (artifact or not) -> kept, folded into Layer 1
//   Layer 3 ("is a connected  -> DROPPED. The tool catalogue and the
//            MCP tool a          Policy Gate already answer this
//            category match?")   per-role and per-tenant. A second,
//                                advisory answer could only contradict
//                                a real permission decision.
//   Layer 4 (which visual)    -> kept, as `mechanism`
//   Layer 5 (images)          -> kept, with one correction: the source
//                                framework says image GENERATION is
//                                unavailable. That is false for
//                                ARCNAVE, which has generate_image
//                                registered. Both routes are offered.
//   Layer 6 (file-type skills)-> NOT IMPLEMENTABLE. It depends on a
//                                skills subsystem ARCNAVE does not
//                                have. `fileTypeGuidance` returns an
//                                explicit "no skill available" rather
//                                than pretending, so a caller can never
//                                read silence as a quality gate having
//                                passed.

class AiOutputFormatValidationError extends Error {}

// Layer 1's real test, from the source framework: is this a standalone
// thing the user will keep and use elsewhere, or something they will
// read once in the chat? Everything else is a refinement of that.
const DESTINATIONS = {
  PROSE: 'prose',
  SECTION: 'section',
  ARTIFACT: 'artifact',
  DOCUMENT: 'document',
};

// Intent signals, checked in priority order — the first match wins, so
// the more specific patterns come first. Deliberately conservative:
// an unmatched request falls through to prose, which is the lightest
// format and therefore the safe default under this policy's own
// principle.
const INTENT_RULES = [
  {
    shape: 'formal_document',
    destination: DESTINATIONS.DOCUMENT,
    pattern: /\b(circular|notice|letter|memo|certificate|official|bonafide|attach(ment)?ing this|for the record|file this)\b/i,
    reason: 'A circular, notice or certificate is an institutional record, so it belongs in DocumentService — '
      + 'use generate_document, not a chat reply.',
  },
  {
    shape: 'report_export',
    destination: DESTINATIONS.DOCUMENT,
    pattern: /\b(export|download|spreadsheet|xlsx|excel|csv|pdf copy|printable)\b/i,
    reason: 'The user wants a file they keep, so route to the reports_generate_* tools or export_artifact_as '
      + 'rather than pasting the content into chat.',
  },
  {
    shape: 'reusable_draft',
    destination: DESTINATIONS.ARTIFACT,
    pattern: /\b(draft|write up|compose|prepare a|policy|proposal|plan document|syllabus|template)\b/i,
    reason: 'A draft the user will revise and reuse is a structured, versioned artifact — create it with the '
      + 'artifact tools so it can be edited and later published, rather than re-pasted every turn.',
  },
  {
    shape: 'comparison',
    destination: DESTINATIONS.SECTION,
    pattern: /\b(compare|versus|vs\.?|side by side|difference between)\b/i,
    reason: 'Use present_comparison so every item answers the same attributes.',
  },
  {
    shape: 'procedure',
    destination: DESTINATIONS.SECTION,
    pattern: /\b(how do i|how to|steps|procedure|walk me through|process for)\b/i,
    reason: 'Use present_steps for an ordered walkthrough.',
  },
  {
    shape: 'diagram',
    destination: DESTINATIONS.SECTION,
    pattern: /\b(diagram|flowchart|org chart|seating plan|draw|sketch|visuali[sz]e the)\b/i,
    reason: 'Use present_diagram; call describe_diagram_constraints first if unsure what SVG it accepts.',
  },
  {
    shape: 'trend',
    destination: DESTINATIONS.SECTION,
    pattern: /\b(trend|over time|chart|graph|month by month|term by term)\b/i,
    reason: 'A chart section is built automatically when a tool returns 2-30 rows with one label and one '
      + 'numeric field — return that shape rather than describing the numbers in prose.',
  },
  {
    shape: 'schedule',
    destination: DESTINATIONS.SECTION,
    pattern: /\b(calendar|timetable|schedule|itinerary|day by day|what.s on)\b/i,
    reason: 'list_calendar_events produces a timeline section automatically.',
  },
  {
    shape: 'assessment',
    destination: DESTINATIONS.SECTION,
    pattern: /\b(quiz|flashcards?|practice questions|test me)\b/i,
    reason: 'Use present_quiz.',
  },
  {
    shape: 'explanation',
    destination: DESTINATIONS.PROSE,
    pattern: /\b(why|explain|what does .* mean|summar(y|ise|ize)|overview|brief me)\b/i,
    reason: 'An explanation is read once, in the chat. Prose is the lightest format that fully serves it — '
      + 'do not manufacture a card or a file for it.',
  },
];

const DEFAULT_DECISION = {
  shape: 'direct_answer',
  destination: DESTINATIONS.PROSE,
  reason: 'Nothing in the request asks for a artifact, file or visual. Answer in plain chat prose — under this '
    + 'policy the lightest format that fully serves the request always wins, and a format is only earned when '
    + 'it changes what the user actually gets.',
};

function decideOutputFormat(request) {
  if (typeof request !== 'string' || !request.trim()) {
    throw new AiOutputFormatValidationError('request is required and must be a non-empty string');
  }
  const matched = INTENT_RULES.find((rule) => rule.pattern.test(request));
  const decision = matched
    ? { shape: matched.shape, destination: matched.destination, reason: matched.reason }
    : { ...DEFAULT_DECISION };
  return {
    ...decision,
    // Restated on every response, not just the prose one: the source
    // framework's failure mode is a model that reads "use a card" and
    // stacks three of them.
    restraint: 'At most one visual per natural point in the conversation, and never a visual that repeats what '
      + 'the prose already said. If a two-line answer would do, give the two lines.',
  };
}

// Layer 5, corrected. The source framework states image generation is
// unavailable and only search exists; that is a fact about the consumer
// environment, not about ARCNAVE, which has generate_image registered.
// Stating it wrongly here would make the model refuse something it can
// actually do.
function decideImageRoute(purpose) {
  if (typeof purpose !== 'string' || !purpose.trim()) {
    throw new AiOutputFormatValidationError('purpose is required and must be a non-empty string');
  }
  const wantsReal = /\b(photo|real|actual|what does .* look like|reference|example of)\b/i.test(purpose);
  const wantsMade = /\b(illustrat|poster|banner|logo|icon|generate|create an image|design)\b/i.test(purpose);
  const isStructural = /\b(flow|process|chart|architecture|org|seating|layout)\b/i.test(purpose);

  if (isStructural) {
    return {
      route: 'diagram',
      tool: 'present_diagram',
      reason: 'Anything structural should be drawn as an SVG diagram, not searched for or generated — it stays '
        + 'accurate to the data and carries no licensing question.',
    };
  }
  if (wantsMade) {
    return {
      route: 'generate',
      tool: 'generate_image',
      reason: 'ARCNAVE has image generation available (unlike the consumer assistant this policy was adapted '
        + 'from) — use it for original artwork rather than searching for something to reuse.',
    };
  }
  if (wantsReal) {
    return {
      route: 'search',
      tool: 'image_search',
      reason: 'A real existing photo is wanted, so search rather than generate. Never search for images of '
        + 'identifiable people.',
    };
  }
  return {
    route: 'none',
    tool: null,
    reason: 'No image is warranted. The source framework\'s own test applies: "would this genuinely help the '
      + 'reader understand", not "could I produce one". Data answers, drafted text and instructions are not '
      + 'helped by pictures.',
  };
}

// Layer 6, corrected 2026-08-26 (second pass): ARCNAVE now HAS a skills
// subsystem and a real quality gate — for exactly one format. Reporting
// "no skill, no gate" uniformly across every type, as this function did
// before that work, would now be WRONG for xlsx specifically, which is
// worse than the original silence problem this function existed to
// avoid: a caller trusting a stale "no gate" answer might tell a user
// a real gate didn't run when it did, or (the more dangerous direction)
// assume xlsx works like docx/pptx/pdf and skip declaring
// `expectFormulasIn`, landing on the honest-but-unhelpful "unverified"
// path recalc.py itself reports.
//
// So this is per-format truth, not a blanket statement. xlsx is checked
// against skillService's real catalogue rather than hardcoded twice in
// two places that could drift apart.
const skillService = require('./skillService');

const KNOWN_FILE_TYPES = {
  xlsx: {
    note: 'A spreadsheet with formulas needs its formulas actually recalculated before delivery, or the cells '
      + 'ship with no cached values and read as blank. Build it with execute_code\'s saveAs + expectFormulasIn — '
      + 'see the xlsx skill (describe_skill(\'xlsx\')) before writing the code, not after it fails.',
    qualityGate: 'recalc',
  },
  docx: {
    note: 'A Word document needs structural validation before delivery. ARCNAVE\'s sandbox has no python-docx '
      + 'and no word-processing engine — this is not currently possible through execute_code. generate_document '
      + 'covers markdown-sourced docx through a different, already-reviewed path.',
    qualityGate: null,
  },
  pptx: {
    note: 'A presentation needs layout and embedded-asset checks before delivery. ARCNAVE\'s sandbox has no '
      + 'python-pptx and no presentation engine — this is not currently possible through execute_code.',
    qualityGate: null,
  },
  pdf: {
    note: 'A generated PDF should be rasterised and visually inspected before delivery — a merged header cell '
      + 'silently zeroing a column is a real, observed failure of this kind. ARCNAVE\'s sandbox has no PDF-writing '
      + 'library — this is not currently possible through execute_code. generate_document/export_artifact_as '
      + 'cover markdown-sourced pdf through a different, already-reviewed path.',
    qualityGate: null,
  },
};

function fileTypeGuidance(fileType) {
  if (typeof fileType !== 'string' || !fileType.trim()) {
    throw new AiOutputFormatValidationError('fileType is required and must be a non-empty string');
  }
  const normalized = fileType.trim().toLowerCase().replace(/^\./, '');
  const known = KNOWN_FILE_TYPES[normalized] || null;
  const skillExists = skillService.listSkills().some((skill) => skill.name === normalized);
  const qualityGate = known ? known.qualityGate : null;

  return {
    fileType: normalized,
    skillAvailable: skillExists,
    qualityGate,
    note: (known && known.note) || `ARCNAVE has no format-specific guidance for ${JSON.stringify(normalized)}.`,
    warning: qualityGate
      ? null
      : 'No quality gate exists for this format — do not tell the user a generated file of this type has been '
        + 'verified, because nothing checked it.',
  };
}

module.exports = {
  AiOutputFormatValidationError,
  DESTINATIONS,
  INTENT_RULES,
  decideOutputFormat,
  decideImageRoute,
  fileTypeGuidance,
};
