'use strict';

// Shared color/type tokens for generated documents (docx/pdf/pptx) — pure
// constants, no DB/storage access (ADR-008). Values are copied from
// frontend/src/index.css's own --c-* custom properties (not re-derived
// from anywhere else), so an AI-generated report looks like it came from
// ARCNAVE, not a generic template — the same "paper/cream, one teal
// accent" system the app's own UI already uses, not Gemini's or any other
// tool's default blue.

const HEX = {
  paper: 'FFFFFF',
  ink: '0A1D28', // headings, card titles
  inkSoft: '1F303B', // body text
  inkMuted: '4A5E6B', // secondary/support text
  accent: '06657B', // banners, header rows, section bars
  accentSoft: 'DCEDF4', // tinted card/row backgrounds
  warm: 'E09038', // secondary accent, sparingly
  line: 'DEE7F1', // borders/rules
};

module.exports = { HEX };
