import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { renderApp as renderAppShared } from './renderApp';
import { CLASS_BY_ID, SCOPE_TOTAL, STAFF_CLASSES, defaultScope } from '../lib/studentsData';

describe('Students — staff teaching scope', () => {
  it('opens on the live class and counts only that class', async () => {
    renderAppShared('/curriculum/students');
    const live = CLASS_BY_ID[defaultScope()];
    expect(live.when).toBe('live');
    // Anchored at the start: unanchored, 'II B.Sc CS — A' also matches
    // 'III B.Sc CS — A' as a substring, so this found two tabs.
    const tab = await screen.findByRole('tab', { name: new RegExp(`^${live.code.replace(/[-—]/g, '.')}`, 'i') });
    expect(tab).toHaveAttribute('aria-selected', 'true');
    expect(await screen.findByText(`${live.studentIds.length} students in ${live.code}`)).toBeInTheDocument();
  });

  it('switches scope in one click and re-counts', async () => {
    const user = userEvent.setup();
    renderAppShared('/curriculum/students');
    const other = STAFF_CLASSES.find((c) => c.when === 'next');
    await user.click(await screen.findByRole('tab', { name: new RegExp(other.subject, 'i') }));
    expect(await screen.findByText(`${other.studentIds.length} students in ${other.code}`)).toBeInTheDocument();
  });

  it('shows the class column and the full staff scope in All my students', async () => {
    const user = userEvent.setup();
    renderAppShared('/curriculum/students');
    await user.click(await screen.findByRole('tab', { name: /all my students/i }));
    expect(
      await screen.findByText(`${SCOPE_TOTAL} students across ${STAFF_CLASSES.length} assigned classes`),
    ).toBeInTheDocument();
    expect(screen.getByText('Class & subject')).toBeInTheDocument();
  });

  it('keeps the sidebar count on the unique staff scope', async () => {
    renderAppShared('/curriculum/students');
    const nav = await screen.findByRole('navigation', { name: /curriculum navigation/i });
    expect(within(nav).getByText(String(SCOPE_TOTAL))).toBeInTheDocument();
  });

  it('has no Add student action', async () => {
    renderAppShared('/curriculum/students');
    await screen.findByRole('heading', { name: 'Students' });
    expect(screen.queryByRole('button', { name: /add student/i })).not.toBeInTheDocument();
  });

  it('shows the selection hint once and never again after it is seen', async () => {
    const user = userEvent.setup();
    localStorage.removeItem('arcnave.students.notifyHintSeen');
    const first = renderAppShared('/curriculum/students');
    expect(await screen.findByText('Select students to notify')).toBeInTheDocument();
    // The control is labelled 'Dismiss tip' in ScopedStudentTable.jsx —
    // this assertion said 'hint' and had gone stale unnoticed.
    await user.click(await screen.findByRole('button', { name: /dismiss tip/i }));
    expect(screen.queryByText('Select students to notify')).not.toBeInTheDocument();
    first.unmount();

    renderAppShared('/curriculum/students');
    await screen.findByRole('heading', { name: 'Students' });
    expect(screen.queryByText('Select students to notify')).not.toBeInTheDocument();
  });

  it('reveals bulk actions only once rows are selected', async () => {
    const user = userEvent.setup();
    renderAppShared('/curriculum/students');
    await screen.findByRole('heading', { name: 'Students' });
    expect(screen.queryByRole('region', { name: /bulk actions/i })).not.toBeInTheDocument();
    const [firstRow] = screen.getAllByRole('checkbox', { name: /^Select (?!all)/i });
    await user.click(firstRow);
    expect(screen.getByRole('region', { name: /bulk actions/i })).toBeInTheDocument();
  });

  it('offers one navigation cluster with Back disabled at the entry route', async () => {
    renderAppShared('/curriculum/students');
    expect(await screen.findByRole('button', { name: 'Go back' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Go forward' })).toBeDisabled();
    expect(screen.getAllByRole('button', { name: /(Collapse|Expand) sidebar/ })).toHaveLength(1);
  });
});
