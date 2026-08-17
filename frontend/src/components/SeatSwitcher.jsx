import { useWorkspace } from '../store/WorkspaceProvider';
import { CLASS_TUTOR_L4, HOD_L3, LEVEL_2, SEAT_KEYS } from '../lib/roles';
import { delegatedEnterable, delegatedScope } from '../lib/delegatedScope';
import { seatScopeNote, seatTitle } from '../lib/seatTitles';
import { DEPARTMENT } from '../lib/departmentData';
import { OWNED_CLASS } from '../lib/classTutorData';
import { cn } from '../lib/utils';

/**
 * Switches which workspace view the prototype renders.
 *
 * **This is a review control, not a permission control.** There is no
 * authentication in this app, so nothing here is being unlocked — it only picks
 * which of the designed experiences is on screen, so each can be reviewed
 * without a separate build. In the real product the active seat comes from the
 * signed-in Position Account, resolved server-side, and a switcher like this
 * one does not exist: a person holds a seat or they do not.
 *
 * The wording is deliberately narrow for that reason — "Workspace view",
 * "preview", "prototype view only". Nothing here says login, switch role, or
 * grants access, because none of those is what this does.
 *
 * **The labels are configured titles, not role keys.** Each button renders what
 * this college calls the seat, resolved through `seatTitles.js`; the key it
 * switches to is never shown. A delegated seat appears here only when the
 * institution was provisioned with one — in an institution without it, there is
 * no entry to press rather than a disabled one, which is the same rule its
 * routes and navigation follow.
 *
 * It lives in the profile drawer's institutional block because that is where
 * "who you are here" is already stated, and it is deliberately plain — a
 * segmented control, no colour beyond the app's selected-surface tone, sitting
 * under a note that says exactly what it is.
 */
export function SeatSwitcher() {
  const { activeRole, setActiveRole } = useWorkspace();

  /*
   * The delegated entry appears only when there is a real delegated workspace to
   * enter — the seat is provisioned *and* somebody holds it. Two states are
   * deliberately not offered rather than offered-and-disabled: an institution
   * with no such seat has nothing to preview, and a configured seat nobody is
   * sitting in would put the viewer into a chair the institution has not filled.
   * Neither may fall through to the Staff experience, which is what selecting
   * this entry used to do before the workspace existed.
   */
  const delegated = delegatedScope();
  const keys = SEAT_KEYS.filter((key) => key !== LEVEL_2 || delegatedEnterable());

  return (
    // The native `title` carries the one-line caveat without introducing a
    // tooltip primitive to a drawer that has none.
    <div title="Changes the prototype view only">
      <div role="radiogroup" aria-label="Workspace view" className="flex items-center gap-[4px] flex-wrap">
        {keys.map((key) => {
          const selected = key === activeRole;
          const scope = seatScopeNote(key, {
            departmentShort: key === HOD_L3 ? DEPARTMENT.short : undefined,
            classCode: key === CLASS_TUTOR_L4 ? OWNED_CLASS.code : undefined,
            areaCount: key === LEVEL_2 ? delegated?.workAreas.length : undefined,
          });
          return (
            <button
              key={key}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => setActiveRole(key)}
              className={cn(
                'flex-none h-[30px] px-[11px] border rounded-[9px] font-sans text-[12.5px] cursor-pointer transition-colors duration-200',
                selected
                  ? 'border-accent-line bg-accent-soft text-accent font-[600]'
                  : 'border-line bg-paper text-ink-muted font-[500] hover:bg-tint2 hover:text-ink'
              )}
            >
              {seatTitle(key)}
              <span className="ml-[6px] text-[11px] font-[400] text-ink-faint">{scope}</span>
            </button>
          );
        })}
      </div>
      <p className="m-0 mt-[9px] text-[12px] font-[400] text-ink-faint">
        Changes the prototype view only. In the product, the active workspace comes from the account you
        signed in with.
      </p>
    </div>
  );
}
