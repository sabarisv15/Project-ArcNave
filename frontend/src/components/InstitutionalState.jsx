/**
 * The standard states an institutional screen has to be able to say out loud.
 *
 * These are not decoration. "No class is assigned to this seat", "nothing is
 * waiting on you" and "this was rejected" are all real, common, correct
 * outcomes, and a screen that renders blank for any of them is telling the user
 * nothing. Each one is a fixed piece of copy so the same situation reads the
 * same way everywhere, rather than each pane inventing its own wording.
 *
 * Built on `TableEmptyState` so they sit inside a table shell with the app's
 * existing rhythm — deliberately quiet, never an illustration or a card.
 */

import { TableEmptyState } from './WorkspaceLayout';

export function NoAssignedClass() {
  return (
    <TableEmptyState
      title="No class is currently assigned to this position."
      hint="This seat's screens will fill in once a class is assigned to it."
    />
  );
}

export function NothingPending() {
  return (
    <TableEmptyState
      title="Nothing is waiting on you."
      hint="Attendance, marks and fee corrections raised for this class will appear here."
    />
  );
}

export function NoResults({ what = 'results' }) {
  return <TableEmptyState title={`No ${what} match these filters.`} hint="Try clearing a filter." />;
}

/**
 * An empty class roster.
 *
 * The hint used to say enrolment was managed from the department's screens,
 * which is not how this product works: a Class Tutor admits genuinely new
 * students into their own class — a first ArcNave onboarding at semester 3, a
 * late admission, a transfer in — and students who were promoted into the class
 * arrive already placed. Neither of those routes goes through a department
 * screen, and telling a tutor to go and look for one would send them nowhere.
 */
export function EmptyRoster() {
  return (
    <TableEmptyState
      title="No students are enrolled in this class yet."
      hint="Promoted students appear here once the promotion review is confirmed. New students can be admitted or imported into this class."
    />
  );
}

/**
 * The department-seat equivalents. Same rule as the class ones above: each of
 * these is a real, correct outcome an HOD screen has to be able to say out loud,
 * and a screen that renders blank for any of them is telling the user nothing.
 */
export function NoAssignedDepartment() {
  return (
    <TableEmptyState
      title="No department is currently assigned to this position."
      hint="This seat's screens will fill in once a department is assigned to it."
    />
  );
}

export function NoClasses() {
  return (
    <TableEmptyState
      title="No classes are running in this department yet."
      hint="Classes appear here once they are created for the academic year."
    />
  );
}

export function NoFaculty() {
  return (
    <TableEmptyState
      title="No faculty are attached to this department yet."
      hint="Staff appear here once they are assigned to the department."
    />
  );
}

export function NoTimetable() {
  return (
    <TableEmptyState
      title="No timetable has been published for this department."
      hint="The live grid appears here once a revision is approved and locked."
    />
  );
}

export function NoConflicts() {
  return (
    <TableEmptyState
      title="No conflicts in the live timetable."
      hint="Faculty clashes, room clashes and unassigned periods would be listed here."
    />
  );
}

/**
 * The institution-seat equivalents. Same rule again: each is a real, correct
 * outcome a Principal screen has to be able to say out loud, and a screen that
 * renders blank for any of them is telling the user nothing.
 */
export function NoDepartments() {
  return (
    <TableEmptyState
      title="No departments are running in this institution yet."
      hint="Departments appear here once they are created for the academic year."
    />
  );
}

export function NothingToEndorse() {
  return (
    <TableEmptyState
      title="Nothing is waiting on your endorsement."
      hint="Endorsed timetable revisions, calendar exceptions and department escalations will appear here."
    />
  );
}

export function NoExceptions() {
  return (
    <TableEmptyState
      title="No unresolved exceptions across the institution."
      hint="Shared-room clashes and academic calendar exceptions would be listed here."
    />
  );
}

/**
 * The prototype is showing a workspace the current Workspace view does not
 * include. Not a permission outcome — this app has no authentication and this
 * state protects nothing; it exists so a deep link into another view's screens
 * says what happened instead of rendering a page the surrounding menu disagrees
 * with.
 */
export function WorkspaceUnavailable({ workspace = 'This workspace' }) {
  return (
    <TableEmptyState
      title={`${workspace} is not part of the Workspace view you are previewing.`}
      hint="Switch the Workspace view from your profile to preview it."
    />
  );
}

/**
 * A workspace this institution was never provisioned with.
 *
 * Deliberately **not** `WorkspaceUnavailable`, and deliberately not a redirect.
 * A URL for an optional seat this institution did not configure has to say the
 * seat does not exist here — bouncing it to the landing page would drop the user
 * into whatever workspace they were already in, which for a personal Staff view
 * is precisely the delegated-to-Staff fallthrough that must never happen.
 * Nothing is hidden and nothing is denied: there is simply nothing of that kind
 * in this institution, and every other workflow is complete without it.
 */
export function WorkspaceNotConfigured({ workspace = 'That workspace' }) {
  return (
    <TableEmptyState
      title={`${workspace} is not part of this institution.`}
      hint="It is an optional position, and this institution was not set up with one. Nothing else depends on it."
    />
  );
}

export function NoWatchlist() {
  return (
    <TableEmptyState
      title="Every student is above the 75% threshold."
      hint="Students who fall below it will be listed here."
    />
  );
}

/**
 * Not a permission mechanism — a piece of copy. Real authority is decided
 * server-side in the product this prototype describes; this only renders the
 * outcome so the screen is never blank when it happens.
 */
export function PermissionDenied({ what = 'this action' }) {
  return (
    <TableEmptyState
      title={`You don't have ${what} for this class.`}
      hint="It may belong to another position, or to a step that has already been decided."
    />
  );
}

export function ArchivedYear() {
  return (
    <TableEmptyState
      title="This is a previous academic year."
      hint="Records stay readable, but nothing here can be changed."
    />
  );
}

/**
 * No academic year is active.
 *
 * Its own state rather than a flavour of "needs attention": governance stays
 * entirely usable without an active year, and what is missing is the year that
 * academic operations would hang off. Attendance in particular does not exist
 * here however many timetables are approved, because there is nothing to record
 * it against.
 */
export function NoActiveAcademicYear() {
  return (
    <TableEmptyState
      title="No academic year is active."
      hint="Classes, timetables and attendance resume once an academic year is commenced."
    />
  );
}

/**
 * A seat nobody holds.
 *
 * A real and fairly common institutional state, not an error — a class runs
 * perfectly well for a fortnight while its seat is being filled. It is
 * deliberately distinct from an outstanding invitation below: nobody has been
 * asked yet, which is a different next step from waiting on an answer.
 */
export function VacantSeat({ seat = 'This position' }) {
  return (
    <TableEmptyState
      title={`${seat} is currently vacant.`}
      hint="Assigning someone to it is the next step; the classes under it keep running meanwhile."
    />
  );
}

/** Someone has been asked and has not accepted yet. Not coverage. */
export function InvitePending({ seat = 'This position' }) {
  return (
    <TableEmptyState
      title={`${seat} has an invitation outstanding.`}
      hint="The seat is not held until the invitation is accepted."
    />
  );
}

/** An institutional seat with no scope attached to it at all. */
export function NoAssignedScope() {
  return (
    <TableEmptyState
      title="No scope is currently delegated to this position."
      hint="This seat's screens will fill in once a scope is delegated to it."
    />
  );
}

/**
 * The seat's session could not be resolved.
 *
 * Not a permission outcome and not an error page — in the product a seat is
 * resolved from the signed-in Position Account, and this is what a screen says
 * when that has not happened. This prototype has no authentication, so nothing
 * here is protecting anything; the copy exists so the state is never blank.
 */
export function SessionUnavailable() {
  return (
    <TableEmptyState
      title="This position's session is unavailable."
      hint="Sign in again to continue in this position."
    />
  );
}

export function Loading({ label = 'Loading…' }) {
  return (
    <div className="py-[48px] px-[20px] text-center" role="status" aria-live="polite">
      <div className="text-[13px] text-ink-muted">{label}</div>
    </div>
  );
}
