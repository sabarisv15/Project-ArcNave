import { Pin } from 'lucide-react';

/**
 * Pinned is a mark, not a word. The label was reading as part of the project's
 * title and taking room from it, so it is a filled pin instead — drawn a step
 * heavier than the interface's other icons so its meaning lands without a
 * caption, and named for assistive technology and on hover. The title itself
 * is unchanged: pinning is a property of the project, not a reason to shout
 * its name.
 */
function PinnedMark() {
  return (
    <span className="inline-flex flex-none text-accent" role="img" aria-label="Pinned project" title="Pinned project">
      <Pin size={13} strokeWidth={2.4} className="fill-current" aria-hidden="true" />
    </span>
  );
}

export function ProjectCard({ project, onOpen }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex flex-col text-left h-[142px] p-[15px] border border-line rounded-[12px] bg-paper font-sans cursor-pointer transition-[box-shadow,border-color] duration-200 hover:shadow-card hover:border-line-strong"
    >
      <span className="flex items-center gap-[7px] text-[14.5px] font-[600]">
        {project.title}
        {project.pinned && <PinnedMark />}
      </span>
      <span className="block mt-[6px] text-[12.8px] leading-[1.5] text-ink-muted flex-1">{project.desc}</span>
      <span className="flex items-center gap-[10px] text-[11.5px] text-ink-faint">
        {project.updated}
        <span className="text-line-strong">·</span>
        {project.count}
      </span>
    </button>
  );
}
