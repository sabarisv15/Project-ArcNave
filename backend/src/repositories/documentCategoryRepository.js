'use strict';

// Query mechanics for `document_categories` only — no business logic
// (that's documentCategoryService's job), same split every other
// repository in this codebase already draws. Tenant scoping relies on
// the table's RLS policy (current_setting('app.current_tenant', true)),
// same as documentRepository — no explicit college_id filter needed
// here.

async function create(client, { collegeId, name, slug }) {
  const result = await client.query(
    `INSERT INTO document_categories (college_id, name, slug)
     VALUES ($1, $2, $3)
     RETURNING *`,
    [collegeId, name, slug],
  );
  return result.rows[0];
}

// The exact 7 categories migration 1756400000000 backfilled for every
// college that existed at the time it ran — that migration's own
// comment flagged that a college created afterward gets none of these
// automatically. createDefaultsForCollege is the fix, called once per
// college (see authService.acceptInvitation) rather than repeated here.
const DEFAULT_CATEGORIES = [
  { name: 'Curriculum', slug: 'curriculum' },
  { name: 'Circulars', slug: 'circular' },
  { name: 'Academic Calendar', slug: 'academic_calendar' },
  { name: 'Examination', slug: 'examination' },
  { name: 'Policies', slug: 'policies' },
  { name: 'Forms', slug: 'forms' },
  { name: 'Notices', slug: 'notices' },
];

// ON CONFLICT DO NOTHING, same as the migration's own backfill —
// idempotent per (college_id, slug), so calling this more than once
// for the same college (e.g. a re-accepted/re-issued invitation) never
// duplicates or errors on a category a principal already renamed away
// from conflicting, since the conflict target is the original slug.
async function createDefaultsForCollege(client, collegeId) {
  const values = DEFAULT_CATEGORIES
    .map((_, i) => `($1, $${i * 2 + 2}, $${i * 2 + 3})`)
    .join(', ');
  const params = [collegeId, ...DEFAULT_CATEGORIES.flatMap((c) => [c.name, c.slug])];
  const result = await client.query(
    `INSERT INTO document_categories (college_id, name, slug)
     VALUES ${values}
     ON CONFLICT (college_id, slug) DO NOTHING
     RETURNING *`,
    params,
  );
  return result.rows;
}

async function findById(client, id) {
  const result = await client.query(
    'SELECT * FROM document_categories WHERE id = $1',
    [id],
  );
  return result.rows[0] || null;
}

async function list(client) {
  const result = await client.query(
    'SELECT * FROM document_categories ORDER BY name',
  );
  return result.rows;
}

// Exact-name lookup — same convention departmentRepository.findByCollegeAndName/
// academicYearRepository.findByCollegeAndYearLabel already use for AI
// identifier resolution (resolveClassId's own sibling functions).
async function findByCollegeAndName(client, collegeId, name) {
  const result = await client.query(
    'SELECT * FROM document_categories WHERE college_id = $1 AND name = $2',
    [collegeId, name],
  );
  return result.rows[0] || null;
}

module.exports = {
  create, findById, list, findByCollegeAndName, createDefaultsForCollege, DEFAULT_CATEGORIES,
};
