/**
 * Which position the sidebar is currently acting in.
 *
 * **Personal Staff and an institutional seat are different contexts, and the
 * shell has to say which one is open.** Until now the only thing that named the
 * seat was a badge inside each screen's scope header — which means the moment a
 * seat's screens are not on screen, nothing distinguishes the contexts at all.
 * A person may hold personal Staff access *and* one or more institutional
 * seats, their data scopes are not the same, and the interface must never
 * quietly merge them.
 *
 * **It renders nothing for personal Staff.** That is deliberate and is the
 * whole rule: the Staff experience is unchanged, and there is no indicator on
 * it to change. A staff member whose designation reads "Principal" or "Class
 * Tutor" is still in the Staff context — a title string never produces
 * institutional chrome, only entering the seat does.
 *
 * Quiet by design: one line above the navigation, the same `tint2`/`ink-soft`
 * vocabulary the scope headers already use, no colour, no new token, no
 * elevation. It names the configured title and the scope, and it is not a
 * control — switching seats stays where it already is, in the profile drawer.
 */

import { useWorkspace } from '../store/WorkspaceProvider';
import { isInstitutionalSeat } from '../lib/roles';
import { seatScopeNote, seatTitle } from '../lib/seatTitles';
import { INSTITUTION_IDENTITY } from '../lib/provisioning';
import { DEPARTMENT } from '../lib/departmentData';
import { OWNED_CLASS } from '../lib/classTutorData';
import { HOD_L3, CLASS_TUTOR_L4, LEVEL_2 } from '../lib/roles';
import { delegatedScope } from '../lib/delegatedScope';

export function SeatContextIndicator() {
  const { activeRole } = useWorkspace();

  if (!isInstitutionalSeat(activeRole)) return null;

  const scope = seatScopeNote(activeRole, {
    departmentShort: activeRole === HOD_L3 ? DEPARTMENT.short : undefined,
    classCode: activeRole === CLASS_TUTOR_L4 ? OWNED_CLASS.code : undefined,
    // A delegated scope is configured rather than structural, so the indicator
    // says how much of it there is instead of naming a fixed unit.
    areaCount: activeRole === LEVEL_2 ? delegatedScope()?.workAreas.length : undefined,
  });

  return (
    <div className="px-[10px] pb-[8px]">
      <div className="flex flex-col gap-[1px] px-[9px] py-[6px] rounded-[10px] bg-tint2">
        <span className="text-[11.5px] font-[500] text-ink-soft leading-[1.3]">
          {seatTitle(activeRole)}
        </span>
        <span className="text-[11px] text-ink-faint leading-[1.3]">
          {INSTITUTION_IDENTITY.name} · {scope}
        </span>
      </div>
    </div>
  );
}
