// Mirrors backend/src/middleware/permissions.js PERMISSION_ROLES exactly.
// Edit only in lockstep with the backend table — this is not a second
// source of truth, it's a client-side copy of the one source of truth.
export const PERMISSION_ROLES = {
  'academic_years.create': ['principal'],
  'academic_years.activate': ['principal'],
  'academic_years.complete': ['principal'],
  'analytics.attendance_rate.read': ['principal', 'hod'],
  'background_jobs.create': ['principal'],
  'background_jobs.read': ['principal'],
  'classes.create': ['principal'],
  'classes.update': ['principal'],
  'classes.delete': ['principal'],
  'classes.promote_semester': ['principal', 'hod'],
  'college_profile.read': ['principal'],
  'college_profile.update': ['principal'],
  'configurations.update': ['principal'],
  'calendar.write': ['principal'],
  'ai_config.read': ['principal'],
  'ai_config.update': ['principal'],
  'departments.read': ['principal'],
  'departments.create': ['principal'],
  'departments.update': ['principal'],
  'departments.delete': ['principal'],
  'hod_in_charge.appoint': ['principal'],
  'documents.upload': ['principal'],
  'documents.templates.upload': ['principal'],
  'documents.institutional.upload': ['principal', 'hod', 'staff'],
  'document_categories.manage': ['principal'],
  'documents.ocr.run': ['principal'],
  'documents.review': ['principal'],
  'documents.delete': ['principal'],
  'faculty_allocation.create': ['principal'],
  'faculty_allocation.delete': ['principal'],
  'notifications.draft': ['principal', 'hod'],
  'notifications.submit': ['principal', 'hod'],
  'notifications.read': ['principal', 'hod'],
  'substitute_assignments.create': ['hod', 'principal'],
  'timetables.generate': ['principal', 'hod'],
  'attendance.lock': ['hod', 'principal'],
  'workflow_delegations.create': ['principal'],
  'archived_records.create': ['principal'],
  'assessment_types.create': ['staff', 'class_tutor', 'hod', 'principal'],
  'assessment_types.update': ['staff', 'class_tutor', 'hod', 'principal'],
  'regulations.create': ['principal'],
  'subjects.create': ['principal'],
  'subjects.update': ['principal'],
  'subjects.delete': ['principal'],
  'reports.generate': ['principal'],
  'reports.student_export': ['principal', 'hod', 'staff'],
  'staff.invite': ['hod'],
  'staff.hod_accounts.create': ['principal'],
  'staff.update': ['principal'],
  'staff.delete': ['principal'],
  'students.create': ['staff'],
  'students.update': ['staff', 'hod', 'principal'],
  'students.delete': ['staff', 'hod', 'principal'],
  'timetable_periods.create': ['principal'],
  'timetable_periods.import_csv': ['principal'],
  'timetable_periods.delete': ['principal'],
};

const ROLE_PERMISSIONS = {};
for (const [permission, roles] of Object.entries(PERMISSION_ROLES)) {
  for (const role of roles) {
    if (!ROLE_PERMISSIONS[role]) ROLE_PERMISSIONS[role] = new Set();
    ROLE_PERMISSIONS[role].add(permission);
  }
}

export function hasPermission(role, permission) {
  if (!permission) return true;
  if (!Object.prototype.hasOwnProperty.call(PERMISSION_ROLES, permission)) return true;
  const perms = ROLE_PERMISSIONS[role];
  return Boolean(perms && perms.has(permission));
}
