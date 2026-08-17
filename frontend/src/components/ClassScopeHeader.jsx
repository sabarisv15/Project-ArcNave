/**
 * The scope line for the Class Tutor seat.
 *
 * A Class Tutor acts inside exactly one class, and every figure, row and
 * decision on an L4 screen is bounded by it — so the scope is stated once, at
 * the top, rather than repeated as a qualifier on each panel.
 *
 * With no class assigned to the seat it stays the same restrained line and says
 * so. It never becomes a large blocking empty state — that belongs to the pane
 * below, which is what actually has nothing to show.
 *
 * The layout is `SeatScopeHeader`, shared with the department and institution
 * seats. What this component owns is which facts a class scope states and in
 * what order. The title defaults to the **configured** one for this seat rather
 * than a literal, so a college that calls the role "Class Advisor" gets that
 * word here without a change to any screen.
 */

import { OWNED_CLASS, classLabel } from '../lib/classTutorData';
import { seatTitle } from '../lib/seatTitles';
import { CLASS_TUTOR_L4 } from '../lib/roles';
import { SeatScopeHeader } from './SeatScopeHeader';
import { useAcademicTerm } from '../store/AcademicTermProvider';

export function ClassScopeHeader({ cls = OWNED_CLASS, roleLabel = seatTitle(CLASS_TUTOR_L4), trail }) {
  /*
   * Year and band come from the **live term**, exactly as the department and
   * institution lines do. The class fixture's own `academicYear` is a baseline
   * label: after a commencement it names the closed term, and this line would
   * have stated that year directly above a screen describing the new one — the
   * one contradiction a scope line must never produce. It is kept only as the
   * fallback for a term that has not resolved.
   */
  const { term, bandLabel } = useAcademicTerm();

  if (!cls) {
    return <SeatScopeHeader empty="No class is currently assigned to this position." />;
  }

  return (
    <SeatScopeHeader
      parts={[
        { label: cls.dept },
        { label: classLabel(cls), strong: true },
        { label: `Semester ${cls.semester}` },
        /*
         * The provisioned capacity of the section, beside the roster count.
         * The gap between them is this class's headroom — the number an
         * admission or an import is actually bounded by — and stating it here
         * is what stops any screen below assuming an even split across
         * sections.
         */
        cls.capacity ? { label: `${cls.studentCount ?? 0} of ${cls.capacity} seats` } : null,
        trail ? { label: trail } : null,
      ]}
      year={term ? term.yearLabel : cls.academicYear}
      band={bandLabel}
      title={roleLabel}
    />
  );
}
