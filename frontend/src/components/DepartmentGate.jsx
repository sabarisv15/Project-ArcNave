import { Outlet } from 'react-router-dom';
import { useWorkspace } from '../store/WorkspaceProvider';
import { HOD_L3 } from '../lib/roles';
import { DepartmentScopeHeader } from './DepartmentScopeHeader';
import { WorkspaceUnavailable } from './InstitutionalState';
import { PANE, StickyTableShell } from './WorkspaceLayout';

/**
 * The department screens render only while the prototype is in the Head of
 * Department workspace view.
 *
 * **This is not an access control.** There is no authentication anywhere in this
 * app and nothing here protects anything — the routes are reachable by typing
 * them. What this prevents is a genuine incoherence: a deep link into
 * `/department` while the sidebar is showing the Staff or Class Tutor menu would
 * put a department workspace on screen underneath a menu that has no department
 * in it, and the user would have no way to tell which one was wrong.
 *
 * So the guard says what happened and where the switch is, rather than
 * redirecting. Bouncing the user to `/` would discard the URL they asked for
 * without explaining why.
 */
export function DepartmentGate() {
  const { activeRole } = useWorkspace();

  if (activeRole !== HOD_L3) {
    return (
      <div className={PANE}>
        <DepartmentScopeHeader />
        <StickyTableShell>
          <WorkspaceUnavailable workspace="The department workspace" />
        </StickyTableShell>
      </div>
    );
  }

  return <Outlet />;
}
