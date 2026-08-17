import { Outlet } from 'react-router-dom';
import { useWorkspace } from '../store/WorkspaceProvider';
import { PRINCIPAL_L1 } from '../lib/roles';
import { InstitutionScopeHeader } from './InstitutionScopeHeader';
import { WorkspaceUnavailable } from './InstitutionalState';
import { PANE, StickyTableShell } from './WorkspaceLayout';

/**
 * The institution screens render only while the prototype is in the Principal
 * workspace view.
 *
 * **This is not an access control.** There is no authentication anywhere in this
 * app and nothing here protects anything — the routes are reachable by typing
 * them. What this prevents is a genuine incoherence: a deep link into
 * `/institution` while the sidebar is showing the Staff, Class Tutor or Head of
 * Department menu would put an institution workspace on screen underneath a menu
 * that has no institution in it, and the user would have no way to tell which
 * one was wrong.
 *
 * So the guard says what happened and where the switch is, rather than
 * redirecting. Bouncing the user to `/` would discard the URL they asked for
 * without explaining why. Same shape as `DepartmentGate`, one level up.
 */
export function InstitutionGate() {
  const { activeRole } = useWorkspace();

  if (activeRole !== PRINCIPAL_L1) {
    return (
      <div className={PANE}>
        <InstitutionScopeHeader />
        <StickyTableShell>
          <WorkspaceUnavailable workspace="The institution workspace" />
        </StickyTableShell>
      </div>
    );
  }

  return <Outlet />;
}
