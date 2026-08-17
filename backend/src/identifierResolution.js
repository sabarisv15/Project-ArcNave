'use strict';

// One tiny, shared "does this string look like a UUID" check —
// pulled out to a leaf util (same shape as cryptoUtil.js) so every
// Business Service's identifier-resolution helper (studentService.
// resolveStudentId, staffService.resolveStaffId, academicService.
// resolveClassId, assessmentService.resolveAssessmentTypeId) uses the
// exact same test, rather than four slightly different regexes
// drifting apart over time. Accepts any RFC 4122 UUID version, not
// just v4 (gen_random_uuid() produces v4, but this should never be
// the thing that rejects a syntactically valid id).
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isUuid(value) {
  return typeof value === 'string' && UUID_PATTERN.test(value);
}

// Thrown by every Business Service's own resolveXId(client, collegeId,
// identifier) helper (studentService.resolveStudentId, staffService.
// resolveStaffId, academicService.resolveClassId, assessmentService.
// resolveAssessmentTypeId) when a caller-supplied identifier is
// neither a real UUID nor a match on the natural key (roll_no/
// staff_code/class_name/assessment type name) it's tried against. One
// shared class (not one per service) so a single caller —
// routes/ai.js's mapAiToolError — can map every one of them to the
// same clean 400 "I couldn't find that" response, rather than letting
// an invalid identifier reach a repository's raw SQL and crash with a
// Postgres type-cast error (the AI Copilot UAT bug this exists to
// fix).
class IdentifierResolutionError extends Error {}

module.exports = { isUuid, IdentifierResolutionError };
