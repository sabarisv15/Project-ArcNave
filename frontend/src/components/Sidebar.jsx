import { cn } from '../lib/utils';
import { useWorkspace } from '../store/WorkspaceProvider';
import { HomeCurriculumToggle } from './HomeCurriculumToggle';
import { SidebarNavigation } from './SidebarNavigation';
import { SeatContextIndicator } from './SeatContextIndicator';
import { SidebarUtilityCluster } from './SidebarUtilityCluster';
import { NotificationBell } from './NotificationBell';
import { Recents } from './Recents';
import { ProfileFooter } from './ProfileFooter';

/**
 * Three regions: fixed brand + navigation, scrolling Recents, pinned profile row.
 * Only the middle region scrolls.
 *
 * A full-height square rail, not a floating card: no outer rounding, margin or
 * shadow, and exactly one hairline separating it from the workspace.
 *
 * Which item list renders is `activeWorkspaceMode` from the store — explicit
 * state, never inferred from the pathname and never re-derived here. The
 * route→mode sync lives in `AppShell`, which stays mounted, and only fires on
 * a genuine navigation; doing it here meant every remount of the sidebar
 * (revealing it as an overlay, pinning it) silently forced the mode back to
 * whatever the URL said, which is what made Home look dead from Curriculum.
 */
export function Sidebar({ floating = false }) {
  const { activeWorkspaceMode } = useWorkspace();

  return (
    <aside
      className={cn(
        'w-[282px] h-full min-h-0 shrink-0 flex flex-col pt-[14px] px-[12px] pb-[10px] overflow-hidden',
        // Docked: a straight full-height rail in paper white (`sidebar`,
        // #F8FBFD) — its own surface, one step under the white workspace and
        // one step over the app ground it sits on, so the three regions read
        // as three without a line between two of them. It stays cool paper,
        // never a block of grey beside the canvas, and the boundary itself is
        // still drawn by the workspace's own rounded island edge.
        // Floating (temporary overlay / mobile drawer): genuinely above the
        // workspace, so it takes the raised white, the firmer floating edge,
        // rounded right corners and one restrained lift.
        floating
          ? 'bg-raised rounded-r-[20px] border-r border-line-strong shadow-pop'
          : 'bg-sidebar rounded-none border-0',
      )}
    >
      <div className="flex-none">
        <div className="flex items-center justify-between pl-[6px] pr-[4px] pb-[2px]">
          <span className="text-[23px] font-[700] tracking-[-.02em]">ArcNave</span>
          <div className="flex items-center gap-[2px]">
            <NotificationBell />
            <SidebarUtilityCluster />
          </div>
        </div>
        <HomeCurriculumToggle />
        {/*
          Which position the rail is acting in. Renders nothing at all in the
          personal Staff context, which is why the Staff sidebar is unchanged.
        */}
        <SeatContextIndicator />
        <SidebarNavigation mode={activeWorkspaceMode} />
      </div>

      <Recents />

      <ProfileFooter />
    </aside>
  );
}
