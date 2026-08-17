'use strict';

// A pure function, same restraint as csvGenerator.js/excelGenerator.js/
// pdfGenerator.js/wordGenerator.js (Architecture.md 2.6 / ADR-008): no
// database access, no storage access, no business rules, no
// permissions. Unlike those four, this doesn't build a document from a
// ReportModel -- it fills {{field}} placeholders into a caller-supplied
// .docx template DocumentService already stored, so it lives here by
// the same "pure function, dedicated module" convention TechStack.md
// names for file generation, not because it's one of Architecture.md
// 2.6's five named Generators.
//
// Library: docxtemplater (+ pizzip, its required zip reader). Same
// pure-JS/no-native-deps criteria ADR-017/019 and wordGenerator.js's
// own comment already used for this project's document tooling -- the
// expected default for "merge {{field}} placeholders into a .docx",
// not a deviation weighing real alternatives, so no ADR (same
// treatment wordGenerator.js's `docx` choice got).
//
// CLAUDE.md rule 9: merge field VALUES are untrusted data (they may
// originate from OCR text, human-entered free text, or a future AI
// draft) and are never interpreted as instructions. docxtemplater
// scans the template's own {{tag}} syntax once, at load time, from the
// template's XML -- a field VALUE is inserted as a literal XML text
// node afterward, never re-parsed for further tags, so a value like
// "{{fullName}}" or "${rm -rf}" in someone's name renders as that
// literal string, not as a nested substitution or a command. The one
// thing that WOULD break this guarantee is attaching the optional
// angular-expressions/eval parser module, which lets a *template*
// author write computed expressions -- deliberately never attached
// here; this function only ever uses docxtemplater's default literal
// tag-substitution mode.
//
// No fixed field list, per this slice's own build brief: whatever
// {{tags}} the uploaded template defines are whatever this function
// fills, or leaves blank (nullGetter below) if the caller didn't
// supply a value for one -- a normal case for a generic, caller-
// defined template, not an error in this function.

const PizZip = require('pizzip');
const Docxtemplater = require('docxtemplater');

// templateBuffer isn't a valid zip/.docx (corrupt upload, wrong file
// type entirely), or the template's own {{tag}} syntax is malformed
// (unclosed tag, etc.) -- distinguished from a plain missing-field
// case, which is not an error at all (see nullGetter below).
class TemplateMergeError extends Error {}

function nullGetter() {
  // A tag with no matching key in `fields` renders as an empty string
  // rather than docxtemplater's default (throw) -- this function has
  // no fixed field list, so "the caller didn't supply this one" is
  // expected, not a bug in either the template or the caller.
  return '';
}

function extractExplanations(err) {
  const subErrors = (err.properties && err.properties.errors) || [];
  return subErrors
    .map((subError) => subError.properties && subError.properties.explanation)
    .filter(Boolean)
    .join('; ');
}

// fields: a flat object of tag-name -> value. Values are inserted as
// literal text (see the file-level comment on rule 9) -- never
// evaluated, never treated as further template syntax.
function mergeTemplate(templateBuffer, fields) {
  let zip;
  try {
    zip = new PizZip(templateBuffer);
  } catch (err) {
    throw new TemplateMergeError(`templateBuffer is not a valid .docx/zip file: ${err.message}`);
  }

  let doc;
  try {
    doc = new Docxtemplater(zip, {
      paragraphLoop: true,
      linebreaks: true,
      nullGetter,
      // docxtemplater's own default delimiter is single-brace
      // {tag}/{/tag} (it reuses the same character for its loop/
      // condition syntax) -- NOT {{tag}}. This project's templates
      // are specified as {{field}} (this slice's own build brief), so
      // the delimiter must be set explicitly; relying on the library
      // default would silently parse "{{studentName}}" as two nested
      // single-brace tags and fail with a confusing "duplicate open
      // tag" error instead of matching what a template author actually
      // wrote.
      delimiters: { start: '{{', end: '}}' },
    });
  } catch (err) {
    throw new TemplateMergeError(extractExplanations(err) || err.message);
  }

  try {
    doc.render(fields || {});
  } catch (err) {
    throw new TemplateMergeError(extractExplanations(err) || err.message);
  }

  return doc.toBuffer();
}

module.exports = { TemplateMergeError, mergeTemplate };
