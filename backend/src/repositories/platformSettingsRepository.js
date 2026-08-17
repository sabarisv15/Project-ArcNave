'use strict';

// Query mechanics for the `platform_settings` singleton row only — no
// business logic. Platform Admin module build, Phase C
// (plans/tingly-marinating-whistle.md). The row is seeded by its own
// migration (1756500000000_platform-settings.js), so getSettings never
// has to handle a missing-row case in normal operation.

async function getSettings(pool) {
  const result = await pool.query(
    `SELECT platform_name, support_email, default_timezone, date_format, items_per_page, default_license, updated_at
     FROM platform_settings WHERE id = true`,
  );
  return result.rows[0] || null;
}

async function updateSettings(pool, {
  platformName, supportEmail, defaultTimezone, dateFormat, itemsPerPage, defaultLicense,
}) {
  const result = await pool.query(
    `UPDATE platform_settings SET
       platform_name = $1,
       support_email = $2,
       default_timezone = $3,
       date_format = $4,
       items_per_page = $5,
       default_license = $6,
       updated_at = now()
     WHERE id = true
     RETURNING platform_name, support_email, default_timezone, date_format, items_per_page, default_license, updated_at`,
    [platformName, supportEmail, defaultTimezone, dateFormat, itemsPerPage, defaultLicense],
  );
  return result.rows[0];
}

module.exports = { getSettings, updateSettings };
