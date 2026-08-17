/**
 * The scope line for the Head of Department seat.
 *
 * Same restraint as the class and institution lines, and now the same
 * implementation: `SeatScopeHeader` owns the layout, and this component owns
 * which facts a department scope states. The seat badge names the position the
 * actions on this screen are taken in, which is what an audit line needs.
 *
 * The band is stated here and not on the class line, because it is the fact
 * that explains the screen below: a department shows four classes rather than
 * six because only one semester band is running, and a reader who cannot see
 * which band is active has no way to tell a short list from a wrong one.
 *
 * The title is the **configured** one for this seat, so a college that calls
 * the role "Department Head" sees that word without any screen changing.
 */

import { DEPARTMENT } from '../lib/departmentData';
import { seatTitle } from '../lib/seatTitles';
import { HOD_L3 } from '../lib/roles';
import { SeatScopeHeader } from './SeatScopeHeader';
import { useAcademicTerm } from '../store/AcademicTermProvider';

export function DepartmentScopeHeader({ dept = DEPARTMENT, roleLabel = seatTitle(HOD_L3), trail }) {
  /*
   * Read from the live term for the same reason the institution line is: the
   * band is the fact that explains the screen below it, and after a
   * commencement a fixed label would explain the wrong term. Nothing else about
   * this seat changes — same layout, same facts, same words.
   */
  const { term, bandLabel } = useAcademicTerm();

  if (!dept) {
    return <SeatScopeHeader empty="No department is currently assigned to this position." />;
  }

  return (
    <SeatScopeHeader
      parts={[
        { label: dept.institution },
        { label: `${dept.short} Department`, strong: true },
        // A drill-through crumb, present only when the screen is showing
        // something narrower than the department itself.
        trail ? { label: trail } : null,
      ]}
      year={term ? term.yearLabel : dept.academicYear}
      band={bandLabel}
      title={roleLabel}
    />
  );
}
