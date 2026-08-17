'use strict';

// BusinessRules.md Documents / Reports — Examination management: "no
// separate Exam Cell module. Each class has a generic Examination
// section, owned by that class's Tutor, for official (University/
// DOTE) examination timetables and related documents — PDF-first
// uploads, versioned."
//
// documents.class_id: nullable, same treatment 1752800000000 already
// gave student_id (nullable, for templates/generated docs with no
// student owner) — extended here to the other direction: a document
// can belong to a CLASS instead of a student. CLAUDE.md rule 2
// (DocumentService is the sole owner of file storage) is why this is
// a new column on the existing `documents` table rather than a second,
// parallel storage table — one storage owner, one row shape, whether
// the owner is a student or a class.
//
// exam_timetable_versions: the versioning/"Current Official" concept
// `documents` itself deliberately has none of (see
// 1752500000000's own file-level comment: re-uploads are just new
// rows, "latest" resolved at query time) — examination timetables are
// the one document type in this schema that needs a real, explicit
// "which version is authoritative right now" flag, per BusinessRules.md:
// "after review and publication, the latest version becomes Current
// Official." A thin wrapper table pointing at a `documents` row,
// not a duplicate storage mechanism.
//
// UNIQUE (class_id) WHERE is_current_official = true: only one Current
// Official version per class at a time — the DB backstop for the rule
// above, same "real constraint over a service-level-only check"
// preference this codebase's other single-active-X columns
// (academic_years, users_one_active_principal_per_college) already
// establish.
//
// Tenant table like every other in this schema: ENABLE + FORCE ROW
// LEVEL SECURITY, tenant_isolation policy on college_id (ADR-002). No
// delete — a published version is a permanent fact, same pattern every
// other lifecycle-ledger table in this schema uses; superseding a
// version flips is_current_official on both rows (old -> false, new ->
// true) via UPDATE, never a delete.

const APP_ROLE = 'arcnave_app';

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql('ALTER TABLE documents ADD COLUMN class_id UUID REFERENCES classes(id)');

  pgm.sql(`
    CREATE TABLE exam_timetable_versions (
        id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        college_id            TEXT NOT NULL REFERENCES colleges(college_id),
        class_id              UUID NOT NULL REFERENCES classes(id),
        document_id           UUID NOT NULL REFERENCES documents(id),
        version_number        INTEGER NOT NULL,
        is_current_official   BOOLEAN NOT NULL DEFAULT false,
        published_by_user_id  UUID NOT NULL REFERENCES users(id),
        published_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
        created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  pgm.sql(`
    CREATE UNIQUE INDEX exam_timetable_versions_class_version_key
        ON exam_timetable_versions (class_id, version_number)
  `);

  pgm.sql(`
    CREATE UNIQUE INDEX exam_timetable_versions_one_current_per_class
        ON exam_timetable_versions (class_id)
        WHERE is_current_official = true
  `);

  pgm.sql('ALTER TABLE exam_timetable_versions ENABLE ROW LEVEL SECURITY');
  pgm.sql('ALTER TABLE exam_timetable_versions FORCE ROW LEVEL SECURITY');
  pgm.sql(`
    CREATE POLICY tenant_isolation ON exam_timetable_versions
        USING (college_id = current_setting('app.current_tenant', true))
  `);

  pgm.sql(`GRANT SELECT, INSERT, UPDATE ON exam_timetable_versions TO ${APP_ROLE}`);
};

exports.down = (pgm) => {
  pgm.sql('DROP TABLE IF EXISTS exam_timetable_versions');
  pgm.sql('ALTER TABLE documents DROP COLUMN IF EXISTS class_id');
};
