import { IDEAS } from '../lib/mockData';

/** Lightweight prompt rows — never dashboard cards. */
export function IdeasList({ onPick }) {
  return (
    <div className="w-full max-w-[760px] mt-[26px]">
      <div className="text-[11.5px] font-[500] tracking-[.06em] uppercase text-ink-faint px-[4px] pb-[6px]">Ideas</div>
      <div className="flex flex-col">
        {IDEAS.map((idea) => (
          <button
            key={idea.title}
            type="button"
            onClick={() => onPick(idea.sub)}
            className="block w-full text-left py-[9px] px-[10px] border-0 border-t border-line-light bg-transparent font-sans cursor-pointer rounded-[8px] transition-colors duration-200 hover:bg-tint2"
          >
            <span className="block text-[13.5px] font-[500]">{idea.title}</span>
            <span className="block mt-[2px] text-[12.5px] text-ink-faint">{idea.sub}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
