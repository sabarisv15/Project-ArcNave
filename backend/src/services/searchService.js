'use strict';

// Phase 4 frontend blueprint's QuickOpen — the one genuinely missing
// backend capability the mapping doc (docs/bka/50-frontend/
// backend-mapping.md §2/§5.5.2) flagged: "a global search across
// students/staff/classes, genuinely absent." Deliberately NOT a new
// repository query: every list here goes through the exact same
// scoped Business Service the roster page / AI roster tools already
// call (studentService.listStudents, staffService.listStaffForActor,
// academicService.listClasses) — RBAC/scope is inherited for free,
// never re-derived here (CLAUDE.md rule 1: never raw SQL from
// anywhere other than a repository, and this file isn't one). Filters
// in memory rather than adding a new ILIKE repository query — this is
// a demo/mid-size-tenant system (hundreds of rows, not millions); if
// that ever stops being true, replace the filter step, not this
// function's shape.
const studentService = require('./studentService');
const staffService = require('./staffService');
const academicService = require('./academicService');

const RESULT_LIMIT = 8;

function matches(query, fields) {
  return fields.some((field) => typeof field === 'string' && field.toLowerCase().includes(query));
}

async function searchAll(client, { query, actorUserId, actorRole, collegeId }) {
  const q = (query || '').trim().toLowerCase();
  if (!q) {
    return { students: [], staff: [], classes: [] };
  }

  const [students, staff, classes] = await Promise.all([
    studentService
      .listStudents(client, { limit: 500 }, { actorUserId, actorRole, collegeId })
      .then((rows) => rows.filter((s) => matches(q, [s.full_name, s.roll_no]))),
    ['principal', 'hod'].includes(actorRole)
      ? staffService
          .listStaffForActor(client, { actorUserId, actorRole, collegeId })
          .then((rows) => rows.filter((s) => matches(q, [s.full_name, s.staff_code])))
      : Promise.resolve([]),
    academicService.listClasses(client, { limit: 500 }).then((rows) => rows.filter((c) => matches(q, [c.class_name]))),
  ]);

  return {
    students: students.slice(0, RESULT_LIMIT).map((s) => ({
      entityType: 'student',
      id: s.id,
      label: s.full_name,
      meta: s.roll_no,
    })),
    staff: staff.slice(0, RESULT_LIMIT).map((s) => ({
      entityType: 'staff',
      id: s.id,
      label: s.full_name,
      meta: s.staff_code,
    })),
    classes: classes.slice(0, RESULT_LIMIT).map((c) => ({
      entityType: 'class',
      id: c.id,
      label: c.class_name,
      meta: null,
    })),
  };
}

module.exports = { searchAll };
