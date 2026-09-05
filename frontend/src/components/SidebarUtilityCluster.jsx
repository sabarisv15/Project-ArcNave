import { useEffect, useState } from 'react';
import { useLocation, useNavigate, useNavigationType } from 'react-router-dom';
import { ArrowLeft, ArrowRight, PanelLeftClose, Pin } from 'lucide-react';
import { IconButton } from './ui/IconButton';
import { useWorkspace } from '../store/WorkspaceProvider';
import { cn } from '../lib/utils';

const BTN =
  'w-[28px] h-[28px] rounded-[8px] bg-transparent hover:bg-hoverline hover:text-ink disabled:text-ink-disabled disabled:cursor-not-allowed disabled:hover:bg-transparent transition-colors duration-200';

/**
 * Back · Forward · Collapse — the workspace's only navigation controls, and
 * they live here in the sidebar's top row beside the ArcNave wordmark, never
 * in a page or workspace header. That is what keeps every route free of a
 * reserved header strip.
 *
 * The third control is whichever action is actually meaningful for the current
 * sidebar mode, never an ambiguous shared one: a temporary overlay offers
 * **Pin sidebar** (dock it), a docked sidebar offers **Collapse sidebar**
 * (remove it from the layout). Icon, tooltip and accessible label all change
 * together with the mode.
 */
export function SidebarUtilityCluster() {
  const navigate = useNavigate();
  const navType = useNavigationType();
  const location = useLocation();
  const { sidebarMode, pinSidebar, collapseSidebar } = useWorkspace();
  const isOverlay = sidebarMode === 'overlay';

  const idx = typeof window !== 'undefined' ? (window.history.state?.idx ?? 0) : 0;
  const [maxIdx, setMaxIdx] = useState(idx);

  useEffect(() => {
    if (navType === 'PUSH') setMaxIdx(idx);
    else if (idx > maxIdx) setMaxIdx(idx);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.key]);

  const canBack = idx > 0;
  const canForward = idx < maxIdx;

  return (
    <div className="flex items-center gap-[2px]">
      <IconButton label="Go back" tooltip="Back" className={BTN} disabled={!canBack} onClick={() => navigate(-1)}>
        <ArrowLeft size={15} strokeWidth={1.8} />
      </IconButton>
      <IconButton
        label="Go forward"
        tooltip="Forward"
        className={BTN}
        disabled={!canForward}
        onClick={() => navigate(1)}
      >
        <ArrowRight size={15} strokeWidth={1.8} />
      </IconButton>
      {isOverlay ? (
        <IconButton label="Pin sidebar" tooltip="Pin sidebar" className={BTN} onClick={pinSidebar}>
          <Pin size={15} strokeWidth={1.8} />
        </IconButton>
      ) : (
        <IconButton label="Collapse sidebar" tooltip="Collapse sidebar" className={BTN} onClick={collapseSidebar}>
          <PanelLeftClose size={15} strokeWidth={1.8} />
        </IconButton>
      )}
    </div>
  );
}
