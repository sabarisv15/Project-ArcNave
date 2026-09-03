import { useStudents } from '../hooks/useStudents';
import { StaffClassSwitcher } from '../components/StaffClassSwitcher';
import { ClassContextHeader } from '../components/ClassContextHeader';
import { StudentsToolbar } from '../components/StudentsToolbar';
import { StudentsFilters, StudentFilterChips } from '../components/StudentsFilters';
import { ScopedStudentTable } from '../components/ScopedStudentTable';
import { StudentBulkTray } from '../components/StudentBulkTray';
import { StudentDetailDrawer } from '../components/StudentDetailDrawer';

/**
 * Curriculum → Students. Class-first: the page opens on the staff member's live
 * (or next) class and every control below refines that scope.
 */
export function StudentsView() {
  const s = useStudents();

  return (
    <>
      <div className="flex-1 min-h-0 overflow-auto scroll-quiet">
        <div className="min-w-[1096px] max-w-[1520px] mx-auto pt-[26px] px-[28px] pb-[40px] animate-viewIn">
          <div className="mb-[18px]">
            <h1 className="m-0 text-[24px] font-[600] tracking-[-.02em]">Students</h1>
            <p className="mt-[5px] mb-0 text-[13px] text-ink-muted">
              Your assigned classes — student records, status and academic progress.
            </p>
          </div>

          <StaffClassSwitcher scope={s.scope} onSelect={s.selectScope} />
          <StudentsToolbar s={s} />
          <StudentFilterChips
            chips={s.activeChips}
            onRemove={(key) => s.setFilter(key, '')}
            onClearAll={s.clearFilters}
          />
          {s.filtersOpen && <StudentsFilters s={s} />}
          <ClassContextHeader scopeIsAll={s.scopeIsAll} scopeClass={s.scopeClass} scopeTotal={s.scopeTotal} />
          <ScopedStudentTable s={s} />
        </div>
      </div>

      {s.anyOverlayOpen && <div aria-hidden="true" onClick={s.closeOverlays} className="fixed inset-0 z-[55]" />}
      {s.selectedCount > 0 && <StudentBulkTray s={s} />}
      <StudentDetailDrawer s={s} />
    </>
  );
}
