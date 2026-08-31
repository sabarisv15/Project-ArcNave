import { useStaff } from '../hooks/useStaff';
import { StaffToolbar } from '../components/StaffToolbar';
import { StaffFilterChips } from '../components/StaffFilters';
import { StaffTable } from '../components/StaffTable';
import { StaffDetailDrawer } from '../components/StaffDetailDrawer';

/** Curriculum → Staff. Directory of teaching and non-teaching staff. */
export function StaffView() {
  const s = useStaff();

  return (
    <>
      {/*
        The page itself no longer scrolls: the heading, toolbar and chips are a
        fixed block and the table owns the only scroll region. That is what
        lets its column header stay put — a sticky header inside a shell that
        is merely clipped (`overflow-hidden`) by a page-level scroller slides
        away with the shell instead of sticking.
      */}
      <div className="flex-1 min-h-0 flex flex-col overflow-hidden animate-viewIn">
        <div className="flex-none w-full max-w-[1180px] mx-auto px-[28px] pt-[26px]">
          <div className="mb-[18px]">
            <h1 className="m-0 text-[24px] font-[600] tracking-[-.02em]">Staff</h1>
            <p className="mt-[5px] mb-0 text-[13px] text-ink-muted">Faculty and staff directory for the institution.</p>
          </div>

          <StaffToolbar s={s} />
          <StaffFilterChips
            chips={s.activeChips}
            onRemove={(key) => s.setFilter(key, '')}
            onClearAll={s.clearFilters}
          />
        </div>

        <div className="flex-1 min-h-0 w-full max-w-[1180px] mx-auto px-[28px] pb-[24px] flex flex-col">
          <StaffTable s={s} />
        </div>
      </div>

      {s.anyOverlayOpen && <div onClick={s.closeOverlays} className="fixed inset-0 z-[55]" />}
      <StaffDetailDrawer s={s} />
    </>
  );
}
