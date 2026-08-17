/** Bulk actions apply only to students selected inside the current class scope. */
export function StudentBulkTray({ s }) {
  return (
    <div
      role="region"
      aria-label="Bulk actions"
      className="absolute left-1/2 -translate-x-1/2 bottom-[20px] z-[70] flex items-center gap-[8px] py-[8px] px-[10px] bg-paper border border-line rounded-[16px] shadow-[0_20px_44px_-24px_rgba(0,0,0,.42)] animate-fadeUp"
    >
      <span className="text-[12.5px] font-[500] text-ink whitespace-nowrap px-[4px]">
        {s.selectedCount} selected in {s.scopeIsAll ? 'all my classes' : s.scopeClass.code}
      </span>
      <button
        type="button"
        onClick={s.notifySelected}
        className="h-[32px] px-[14px] border-0 rounded-[11px] bg-accent text-white font-sans text-[12.5px] font-[500] cursor-pointer transition-colors duration-200 hover:bg-accent-hover active:scale-[.985] motion-reduce:active:scale-100"
      >
        Notify
      </button>
      <button
        type="button"
        onClick={s.exportSelected}
        className="h-[32px] px-[14px] border border-accent-line rounded-[11px] bg-accent-soft text-accent font-sans text-[12.5px] font-[500] cursor-pointer transition-colors duration-200 hover:bg-accent-soft2 active:scale-[.985] motion-reduce:active:scale-100"
      >
        Export
      </button>
      <button
        type="button"
        onClick={s.clearSelection}
        className="h-[32px] px-[10px] border-0 rounded-[10px] bg-transparent font-sans text-[12.5px] text-ink-muted cursor-pointer transition-colors duration-200 hover:bg-tint2 hover:text-ink"
      >
        Clear
      </button>
    </div>
  );
}
