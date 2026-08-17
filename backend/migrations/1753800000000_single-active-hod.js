'use strict';

// BusinessRules.md: at most one active HOD per department.
//
// The original service check is useful for a clean error message, but
// two concurrent approvals could still race. PostgreSQL cannot index a
// join between users.role/is_active and staff.department_id directly,
// so this migration mirrors the active HOD department onto users and
// protects that mirror with a partial unique index.

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql('ALTER TABLE users ADD COLUMN active_hod_department_id UUID REFERENCES departments(id)');

  pgm.sql(`
    CREATE OR REPLACE FUNCTION sync_active_hod_department_for_user(target_user_id UUID)
    RETURNS void
    LANGUAGE plpgsql
    AS $$
    BEGIN
      UPDATE users
      SET active_hod_department_id = CASE
        WHEN users.role = 'hod' AND users.is_active = true THEN staff.department_id
        ELSE NULL
      END
      FROM staff
      WHERE users.id = target_user_id
        AND staff.user_id = users.id;

      UPDATE users
      SET active_hod_department_id = NULL
      WHERE users.id = target_user_id
        AND NOT EXISTS (SELECT 1 FROM staff WHERE staff.user_id = target_user_id);
    END;
    $$
  `);

  pgm.sql(`
    CREATE OR REPLACE FUNCTION sync_active_hod_department_from_staff()
    RETURNS trigger
    LANGUAGE plpgsql
    AS $$
    BEGIN
      IF TG_OP = 'DELETE' THEN
        PERFORM sync_active_hod_department_for_user(OLD.user_id);
        RETURN OLD;
      END IF;

      PERFORM sync_active_hod_department_for_user(NEW.user_id);
      IF TG_OP = 'UPDATE' AND OLD.user_id IS DISTINCT FROM NEW.user_id THEN
        PERFORM sync_active_hod_department_for_user(OLD.user_id);
      END IF;
      RETURN NEW;
    END;
    $$
  `);

  pgm.sql(`
    CREATE OR REPLACE FUNCTION sync_active_hod_department_from_users()
    RETURNS trigger
    LANGUAGE plpgsql
    AS $$
    BEGIN
      PERFORM sync_active_hod_department_for_user(NEW.id);
      RETURN NEW;
    END;
    $$
  `);

  pgm.sql(`
    CREATE TRIGGER staff_sync_active_hod_department
    AFTER INSERT OR UPDATE OF user_id, department_id OR DELETE ON staff
    FOR EACH ROW EXECUTE FUNCTION sync_active_hod_department_from_staff()
  `);

  pgm.sql(`
    CREATE TRIGGER users_sync_active_hod_department
    AFTER INSERT OR UPDATE OF role, is_active ON users
    FOR EACH ROW EXECUTE FUNCTION sync_active_hod_department_from_users()
  `);

  pgm.sql(`
    SELECT sync_active_hod_department_for_user(users.id)
    FROM users
  `);

  pgm.sql(`
    CREATE UNIQUE INDEX users_one_active_hod_per_department
      ON users (college_id, active_hod_department_id)
      WHERE role = 'hod'
        AND is_active = true
        AND active_hod_department_id IS NOT NULL
  `);
};

exports.down = (pgm) => {
  pgm.sql('DROP INDEX IF EXISTS users_one_active_hod_per_department');
  pgm.sql('DROP TRIGGER IF EXISTS users_sync_active_hod_department ON users');
  pgm.sql('DROP TRIGGER IF EXISTS staff_sync_active_hod_department ON staff');
  pgm.sql('DROP FUNCTION IF EXISTS sync_active_hod_department_from_users()');
  pgm.sql('DROP FUNCTION IF EXISTS sync_active_hod_department_from_staff()');
  pgm.sql('DROP FUNCTION IF EXISTS sync_active_hod_department_for_user(UUID)');
  pgm.sql('ALTER TABLE users DROP COLUMN IF EXISTS active_hod_department_id');
};
