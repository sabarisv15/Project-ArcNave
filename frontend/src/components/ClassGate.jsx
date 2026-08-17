import { Outlet } from 'react-router-dom';
import { useWorkspace } from '../store/WorkspaceProvider';
import { CLASS_TUTOR_L4 } from '../lib/roles';
import { ClassScopeHeader } from './ClassScopeHeader';
import { WorkspaceUnavailable } from './InstitutionalState';
import { PANE, StickyTableShell } from './WorkspaceLayout';

/**
 * The class screens render only while the prototype is in the Class Tutor
 * workspace view.
 *
 * **This is not an access control.** There is no authentication anywhere in this
 * app and nothing here protects anything — the routes are reachable by typing
 * them. What this prevents is a genuine incoherence: a deep link into
 * `/curriculum/my-class` while the sidebar is showing the Staff, Head of
 * Department or Principal menu would put a single-class workspace on screen
 * underneath a menu that has no such class in it, and the user would have no way
 * to tell which one was wrong.
 *
 * L4 was the one seat without this guard — `/department` and `/institution` got
 * theirs when they were built, and the class routes kept rendering the tutor's
 * screens under the Staff menu. Same shape as the other two, one level down.
 *
 * The guard **says what happened and where the switch is, rather than
 * redirecting**. Bouncing the user to `/` would discard the URL they asked for
 * without explaining why.
 *
 * The routes themselves stay exactly where they are, under `/curriculum/my-class`.
 * The objective is scope isolation, not URL symmetry with the other two seats.
 */
export function ClassGate() {
  const { activeRole } = useWorkspace();

  if (activeRole !== CLASS_TUTOR_L4) {
    return (
      <div className={PANE}>
        <ClassScopeHeader />
        <StickyTableShell>
          <WorkspaceUnavailable workspace="The class workspace" />
        </StickyTableShell>
      </div>
    );
  }

  return <Outlet />;
}
