import { useLocation, useNavigate } from 'react-router-dom';
import { cn } from '../lib/utils';
import { useWorkspace } from '../store/WorkspaceProvider';

/**
 * The two top-level workspace mode toggles — deliberately asymmetric.
 *
 * **Home** is a destination: from any route, any Curriculum page and any open
 * drawer, it closes the transient surfaces and goes to the Home landing, so
 * the toggle can never end up selected while a Curriculum page is still on
 * screen. Going to `/` also drops any drawer that lives in the query string
 * (e.g. Attendance's `?period=`).
 *
 * **Curriculum** is only a menu mode: it swaps the sidebar's item list and
 * navigates nowhere, so it never picks Students (or anything else) for the
 * user. A Curriculum child item is what actually routes.
 */
export function HomeCurriculumToggle() {
  const navigate = useNavigate();
  const { pathname, search } = useLocation();
  const { activeWorkspaceMode, setActiveWorkspaceMode, setScheduleOpen, setProfileDrawerOpen } = useWorkspace();
  const isCurriculum = activeWorkspaceMode === 'curriculum';

  const goHome = () => {
    setScheduleOpen(false);
    setProfileDrawerOpen(false);
    setActiveWorkspaceMode('home');
    if (pathname !== '/' || search) navigate('/');
  };

  const item = (label, active, onClick) => (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={cn(
        'flex-1 h-[28px] border-0 rounded-[7px] font-sans text-[12.5px] cursor-pointer transition-colors duration-200',
        active
          ? 'bg-paper text-ink-soft font-[600] shadow-seg'
          : 'bg-transparent text-ink-muted font-[500] hover:text-ink-soft',
      )}
    >
      {label}
    </button>
  );

  return (
    // The track is `tint2`, not `frame`: the app ground and paper now sit within
    // a percent of each other, so a frame-coloured track would leave the raised
    // active segment with nothing to read against.
    <div
      role="tablist"
      aria-label="Workspace context"
      className="flex gap-[2px] mx-[4px] mt-[12px] mb-[10px] p-[2px] bg-tint2 rounded-[11px]"
    >
      {item('Home', !isCurriculum, goHome)}
      {item('Curriculum', isCurriculum, () => setActiveWorkspaceMode('curriculum'))}
    </div>
  );
}
