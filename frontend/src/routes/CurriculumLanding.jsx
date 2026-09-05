import { NavLink } from 'react-router-dom';
import { LayoutGrid } from 'lucide-react';
import { cn } from '../lib/utils';
import { useWorkspace } from '../store/WorkspaceProvider';
import { curriculumNavFor } from '../components/SidebarNavigation';

/**
 * Quiet neutral landing shown only until the user picks a Curriculum sub-item —
 * never Students by default. Deliberately not card-heavy: a compact centered
 * message plus a short text-link list, not a dashboard.
 *
 * The list is the sidebar's own for the active seat, not a second hand-kept
 * copy: the two can never disagree, and this screen can never offer a
 * destination the seat's menu doesn't have.
 */
export function CurriculumLanding() {
  const { activeRole } = useWorkspace();
  const ITEMS = curriculumNavFor(activeRole);

  return (
    <div className="flex-1 min-h-0 overflow-y-auto scroll-quiet flex items-center justify-center px-[32px] animate-viewIn">
      <div className="max-w-[360px] text-center">
        <span className="inline-flex w-[40px] h-[40px] items-center justify-center rounded-[12px] bg-tint2 text-ink-faint mb-[14px]">
          <LayoutGrid size={19} strokeWidth={1.8} aria-hidden="true" />
        </span>
        <p className="m-0 text-[13.5px] text-ink-muted">Select a section to continue.</p>
        <nav aria-label="Curriculum sections" className="mt-[16px] flex flex-col gap-[2px] text-left">
          {ITEMS.map(({ to, label, Icon }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                cn(
                  'flex items-center gap-[10px] h-[34px] px-[10px] rounded-[9px] text-[13px] font-[500] text-ink-soft no-underline hover:no-underline transition-colors duration-200 hover:bg-hoverline',
                  isActive && 'bg-accent-soft text-accent font-[600]',
                )
              }
            >
              <Icon size={16} strokeWidth={1.8} aria-hidden="true" />
              {label}
            </NavLink>
          ))}
        </nav>
      </div>
    </div>
  );
}
