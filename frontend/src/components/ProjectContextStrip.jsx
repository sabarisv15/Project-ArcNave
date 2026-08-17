import { FolderKanban } from 'lucide-react';

/** Physically tucked behind the composer — lower z-index, inset, no divider, no action. */
export function ProjectContextStrip({ projectTitle }) {
  return (
    <div className="relative z-[1] -mt-[16px] mx-[14px] pt-[22px] px-[16px] pb-[12px] bg-soft border border-line border-t-0 rounded-b-[15px] flex items-center gap-[10px]">
      <FolderKanban size={16} strokeWidth={1.75} className="text-accent shrink-0" />
      <span className="text-[12.5px] text-ink-muted">{projectTitle} · Project context active</span>
    </div>
  );
}

/** Small indicator shown once the project conversation has started. */
export function ProjectContextBadge({ projectTitle }) {
  return (
    <div className="shrink-0 px-[28px] pb-[8px]">
      <span className="inline-flex items-center gap-[7px] text-[11.5px] text-ink-muted bg-soft border border-line rounded-full py-[4px] px-[11px]">
        <FolderKanban size={13} strokeWidth={1.9} className="text-accent" />
        {projectTitle} · Context active
      </span>
    </div>
  );
}
