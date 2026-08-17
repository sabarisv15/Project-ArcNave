/**
 * The scope line for the delegated seat.
 *
 * The fourth wrapper over `SeatScopeHeader`, and the only one whose scope is not
 * a structural unit. A class tutor's scope is a class and a head of department's
 * is a department; a delegated seat's scope is **whatever was delegated**, so
 * this line states the institution, how many departments the seat covers, and
 * nothing it was not configured with.
 *
 * Year and band come from the live term, exactly as the institution and
 * department lines do — a delegated seat reads the same running term everyone
 * else does, and a header that kept a baseline label would describe the closed
 * term above a screen describing the new one.
 *
 * The title is the configured one. A college that calls this seat "Vice
 * Principal" sees that word here and nothing in this component changes.
 */

import { SeatScopeHeader } from './SeatScopeHeader';
import { useAcademicTerm } from '../store/AcademicTermProvider';
import { delegatedScope } from '../lib/delegatedScope';

export function DelegatedScopeHeader({ scope = delegatedScope(), trail }) {
  const { term, bandLabel } = useAcademicTerm();

  if (!scope) {
    return <SeatScopeHeader empty="No delegated position is configured for this institution." />;
  }

  const count = scope.departments.length;

  return (
    <SeatScopeHeader
      parts={[
        { label: scope.institution.name },
        {
          label:
            count === 0
              ? 'No delegated departments'
              : `${count} delegated ${count === 1 ? 'department' : 'departments'}`,
          strong: true,
        },
        count > 0 ? { label: scope.departments.map((d) => d.short).join(' · ') } : null,
        trail ? { label: trail } : null,
      ]}
      year={term?.yearLabel}
      band={bandLabel}
      title={scope.title}
    />
  );
}
