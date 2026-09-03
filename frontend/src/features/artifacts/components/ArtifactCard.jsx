export function ArtifactCard({ artifact, onOpen }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex flex-col text-left p-0 border border-line rounded-[12px] bg-paper font-sans cursor-pointer overflow-hidden transition-[box-shadow,border-color] duration-200 hover:shadow-card hover:border-line-strong"
    >
      <span className="block h-[110px] bg-tint border-b border-line-light pt-[14px] px-[16px] overflow-hidden">
        <span className="block h-[7px] w-[62%] bg-line-strong rounded-[3px] mb-[7px]" />
        <span className="block h-[5px] w-[92%] bg-line rounded-[3px] mb-[5px]" />
        <span className="block h-[5px] w-[85%] bg-line rounded-[3px] mb-[5px]" />
        <span className="block h-[5px] w-[70%] bg-line rounded-[3px] mb-[5px]" />
        <span className="block h-[5px] w-[88%] bg-line rounded-[3px]" />
      </span>
      <span className="block pt-[11px] px-[14px] pb-[12px]">
        <span className="block text-[13.5px] font-[500] leading-[1.35]">{artifact.title}</span>
        <span className="flex items-center gap-[7px] mt-[5px] text-[11.5px] text-ink-faint">
          {artifact.type}
          <span className="text-line-strong">·</span>
          {artifact.edited}
        </span>
        {artifact.link && <span className="block mt-[4px] text-[11.5px] text-accent">{artifact.link}</span>}
      </span>
    </button>
  );
}
