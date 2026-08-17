import { Outlet } from 'react-router-dom';
import { useWorkspace } from '../store/WorkspaceProvider';
import { LEVEL_2 } from '../lib/roles';
import { delegatedScope } from '../lib/delegatedScope';
import { DelegatedScopeHeader } from './DelegatedScopeHeader';
import { VacantSeat, WorkspaceNotConfigured, WorkspaceUnavailable } from './InstitutionalState';
import { PANE, StickyTableShell } from './WorkspaceLayout';

/**
 * The delegated screens render only while the prototype is in the delegated
 * workspace view, and only where the institution actually has that seat filled.
 *
 * **This is not an access control.** There is no authentication anywhere in this
 * app and nothing here protects anything. What it prevents is three different
 * incoherences that a single "not allowed" state would flatten into one:
 *
 *  - **No such seat.** The institution was provisioned without a delegated
 *    position. The URL is not denied, it is meaningless here, and the copy says
 *    so. It must never resolve to the Staff workspace, a Staff menu or a silent
 *    redirect to the landing page — a delegated URL quietly becoming the Staff
 *    home is the exact defect this phase exists to remove.
 *  - **Seat vacant.** The position exists, its configured workflow chain still
 *    routes through it, and nobody holds it. There is no workspace to enter
 *    until there is somebody to enter it, and a revision routed here stays
 *    visibly with this seat rather than skipping ahead.
 *  - **Another seat is previewing.** The ordinary `DepartmentGate` /
 *    `InstitutionGate` case: a deep link taken while a different workspace view
 *    is selected, answered by saying so rather than by redirecting.
 *
 * Same shape as the other three gates: it explains, it never bounces.
 */
export function DelegatedGate() {
  const { activeRole } = useWorkspace();
  const scope = delegatedScope();

  if (!scope) return <DelegatedNotConfigured />;

  if (activeRole !== LEVEL_2) {
    return (
      <Blocked scope={scope}>
        <WorkspaceUnavailable workspace="The delegated workspace" />
      </Blocked>
    );
  }

  if (!scope.occupied) {
    return (
      <Blocked scope={scope}>
        <VacantSeat seat={scope.title} />
      </Blocked>
    );
  }

  return <Outlet />;
}

/**
 * What a `/delegated` URL renders in an institution that has no such seat.
 *
 * Mounted as the route itself rather than reached through the gate, because in
 * that institution there is no delegated route family to gate — this is the
 * whole of what the path resolves to. It keeps the neutral institutional state
 * and the scope header's empty line, so the page is never blank and never
 * someone else's workspace.
 */
export function DelegatedNotConfigured() {
  return (
    <div className={PANE}>
      <DelegatedScopeHeader scope={null} />
      <StickyTableShell>
        <WorkspaceNotConfigured workspace="A delegated workspace" />
      </StickyTableShell>
    </div>
  );
}

function Blocked({ scope, children }) {
  return (
    <div className={PANE}>
      <DelegatedScopeHeader scope={scope} />
      <StickyTableShell>{children}</StickyTableShell>
    </div>
  );
}
