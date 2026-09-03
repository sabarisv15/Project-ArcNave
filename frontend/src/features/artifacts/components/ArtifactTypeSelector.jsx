import { ARTIFACT_TYPES } from '@/lib/mockData';

/** Seven artifact forms. No composer is shown until one is selected. */
export function ArtifactTypeSelector({ onSelect }) {
  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-[12px]">
      {ARTIFACT_TYPES.map((t) => (
        <button
          key={t.key}
          type="button"
          onClick={() => onSelect(t.key)}
          className="block text-left pt-[14px] px-[15px] pb-[14px] border border-line rounded-[12px] bg-paper font-sans cursor-pointer transition-[border-color,box-shadow] duration-200 hover:border-accent-line hover:shadow-typeCard"
        >
          <span className="block text-[14px] font-[600]">{t.key}</span>
          <span className="block mt-[4px] text-[12.3px] leading-[1.5] text-ink-faint">{t.desc}</span>
        </button>
      ))}
    </div>
  );
}
