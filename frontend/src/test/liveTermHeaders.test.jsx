import { act, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import {
  AcademicTermProvider,
  useAcademicTerm,
  AcademicRosterProvider,
  InstitutionalLifecycleProvider,
} from '@/features/institution';
import { ClassScopeHeader } from '../components/ClassScopeHeader';
import { DepartmentScopeHeader } from '../components/DepartmentScopeHeader';
import { InstitutionScopeHeader } from '../components/InstitutionScopeHeader';
import { DelegatedScopeHeader } from '../components/DelegatedScopeHeader';

/**
 * Every institutional scope line reads the **live** term.
 *
 * A scope header states the frame everything below it is true inside. After a
 * commencement, a header still holding its fixture's baseline label states the
 * closed term's year and band directly above a screen describing the new one —
 * the one contradiction a scope line must never produce. The institution and
 * department lines were corrected earlier; the class line kept a fixture label
 * and no band at all, which is the gap this closes.
 */

let commence;

function Commence() {
  const term = useAcademicTerm();
  commence = () => term.commenceNextSemester({ confirmed: true });
  return null;
}

function Headers() {
  return (
    <AcademicTermProvider>
      <AcademicRosterProvider>
        <InstitutionalLifecycleProvider>
          <Commence />
          <ClassScopeHeader />
          <DepartmentScopeHeader />
          <InstitutionScopeHeader />
          <DelegatedScopeHeader />
        </InstitutionalLifecycleProvider>
      </AcademicRosterProvider>
    </AcademicTermProvider>
  );
}

describe('the scope headers follow the live term', () => {
  it('states one year and one band across all four seats, before and after a commencement', () => {
    render(<Headers />);

    const yearsBefore = screen.getAllByText(/^AY /).map((n) => n.textContent);
    const bandsBefore = screen.getAllByText(/^Semester band|^Odd|^Even/i).map((n) => n.textContent);

    // Every header states the same year — four seats, one term.
    expect(yearsBefore).toHaveLength(4);
    expect(new Set(yearsBefore).size).toBe(1);
    expect(new Set(bandsBefore).size).toBe(1);
    expect(bandsBefore).toHaveLength(4);

    act(() => {
      const outcome = commence();
      expect(outcome.ok).toBe(true);
    });

    const yearsAfter = screen.getAllByText(/^AY /).map((n) => n.textContent);
    const bandsAfter = screen.getAllByText(/^Semester band|^Odd|^Even/i).map((n) => n.textContent);

    expect(yearsAfter).toHaveLength(4);
    expect(new Set(yearsAfter).size).toBe(1);
    expect(bandsAfter).toHaveLength(4);
    expect(new Set(bandsAfter).size).toBe(1);

    // The term genuinely moved, and no header stayed behind on the closed one.
    expect(`${yearsAfter[0]} ${bandsAfter[0]}`).not.toBe(`${yearsBefore[0]} ${bandsBefore[0]}`);
    expect(yearsAfter).not.toContain(undefined);
  });

  it('leaves no header on a stale baseline label after the term moves', () => {
    render(<Headers />);
    const before = screen.getAllByText(/^AY /)[0].textContent;
    const bandBefore = screen.getAllByText(/^Semester band|^Odd|^Even/i)[0].textContent;

    act(() => {
      commence();
    });

    const stale = screen
      .getAllByText(/^AY /)
      .map((n) => n.textContent)
      .filter((t) => t === before && bandBefore === screen.getAllByText(/^Semester band|^Odd|^Even/i)[0].textContent);

    // Either the year moved or the band did; nothing may report both unchanged.
    expect(stale).toHaveLength(0);
  });
});
