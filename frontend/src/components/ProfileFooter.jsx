import * as Avatar from '@radix-ui/react-avatar';
import { useWorkspace } from '../store/WorkspaceProvider';

/**
 * The pinned sidebar profile: avatar, name, role, and nothing else.
 *
 * It is separated from Recents by exactly one quiet hairline — the rail's only
 * divider — and the avatar deliberately **crosses** it. A portrait lifted over
 * the boundary of its own section is the one thing in the rail that is allowed
 * to break the grid, and it reads as a floating avatar rather than a clipped
 * one: every container from here up keeps `overflow-visible`, so the circle is
 * never cut by the edge it is overlapping.
 *
 * Everything else in the block gets smaller in exchange. The avatar grew, so
 * the padding, the type and the row height all came down to keep the footprint
 * at roughly what it was — a bigger portrait, not a bigger panel, and no blank
 * space under it.
 *
 * Sign out is not here. It lives in the ProfileDrawer header beside Close,
 * where the rest of the account actions are; a rail footer is navigation, and
 * a destructive session action does not belong in it.
 */
export function ProfileFooter() {
  const { setProfileDrawerOpen } = useWorkspace();
  return (
    <div className="flex-none mt-auto overflow-visible">
      <div className="h-px bg-line opacity-70 mx-[8px] mt-[2px]" />
      <div className="relative flex items-center px-[8px] pt-0 pb-[2px] overflow-visible">
        <button
          type="button"
          aria-label="Open profile"
          title="View profile"
          onClick={() => setProfileDrawerOpen(true)}
          className="flex items-center gap-[10px] flex-1 min-w-0 py-[3px] px-[6px] border-0 bg-transparent rounded-[11px] font-sans text-left cursor-pointer overflow-visible transition-colors duration-200 hover:bg-hoverline"
        >
          {/* Pulled up by half its own growth so it sits over the hairline
              above, and given the paper ring so the crossing reads as
              deliberate rather than as an overlap accident. 46px compact,
              56px from `lg` — the rail is the same width in both, but the
              floating portrait is a desktop gesture and stays restrained on
              the mobile drawer. */}
          <Avatar.Root className="shrink-0 -mt-[16px] lg:-mt-[20px] w-[46px] h-[46px] lg:w-[56px] lg:h-[56px] rounded-full border-[2.5px] border-paper shadow-avatar overflow-hidden block">
            <Avatar.Image src="https://i.pravatar.cc/120?img=47" alt="Priya Ramesh" className="w-full h-full object-cover" />
            {/* The avatar is the interface's one saturated element — a person,
                not a control, so it takes the amber rather than the accent. */}
            <Avatar.Fallback className="w-full h-full grid place-items-center bg-warm-soft text-warm text-[15px] font-[600]">
              PR
            </Avatar.Fallback>
          </Avatar.Root>
          <span className="block min-w-0 flex-1">
            <span className="block text-[12.5px] font-[500] leading-[1.2] truncate">Priya Ramesh</span>
            <span className="block text-[11px] leading-[1.3] text-ink-faint truncate">Academic Coordinator</span>
          </span>
        </button>
      </div>
    </div>
  );
}
