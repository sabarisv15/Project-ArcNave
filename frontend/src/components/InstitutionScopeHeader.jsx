/**
 * The scope line for the Principal seat.
 *
 * Same restraint and the same implementation as the department and class lines
 * — `SeatScopeHeader` owns the layout, this component owns which facts an
 * institution scope states.
 *
 * It carries the semester band for the same reason the department line does:
 * an institution running 25 active classes rather than 40 is running one band,
 * and a Principal reading a coverage figure needs to know which classes it is a
 * figure *about*.
 *
 * The title is the **configured** one for this seat, so a college that calls
 * the role "Director" sees that word without any screen changing.
 */

import { INSTITUTION } from '../lib/institutionData';
import { seatTitle } from '../lib/seatTitles';
import { PRINCIPAL_L1 } from '../lib/roles';
import { SeatScopeHeader } from './SeatScopeHeader';
import { useAcademicTerm } from '@/features/institution';

export function InstitutionScopeHeader({ institution = INSTITUTION, roleLabel = seatTitle(PRINCIPAL_L1), trail }) {
  /*
   * The year and band come from the **live term**, not from the fixture's own
   * label. They used to be module constants, which was correct while the term
   * could not change — after a commencement the header stated the closed term's
   * year and band directly above a page describing the new one, which is the
   * one contradiction a scope line must never produce.
   */
  const { term, bandLabel } = useAcademicTerm();

  if (!institution) {
    return <SeatScopeHeader empty="No institution is currently assigned to this position." />;
  }

  return (
    <SeatScopeHeader
      parts={[
        { label: institution.name, strong: true },
        { label: 'All departments' },
        // Present only when the screen is showing something narrower than the
        // institution itself — one department's roster, say.
        trail ? { label: trail } : null,
      ]}
      year={term ? term.yearLabel : institution.academicYear}
      band={bandLabel}
      title={roleLabel}
    />
  );
}
