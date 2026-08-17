import { useNavigate, useParams } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';
import { DelegatedScopeHeader } from '../components/DelegatedScopeHeader';
import { NoAssignedScope, NoResults } from '../components/InstitutionalState';
import { PANE, StickyTableShell, TABLE_HEAD } from '../components/WorkspaceLayout';
import { DELEGATED_ROOT, delegatedScope, delegatedWorkArea } from '../lib/delegatedScope';
import { DEPARTMENT_BY_ID } from '../lib/institutionData';

/**
 * Work Areas — the delegated work this institution configured, and only that.
 *
 * **There is no catalogue of delegated work areas in this product.** An area is
 * a provisioned string with a note; a college that configured two has two rows,
 * a college that configured none has an empty state that says the seat carries
 * no standing work areas, and neither is more correct than the other. Inventing
 * Attendance, Exams or Assessments rows here — the duty modules a "Dean" is
 * assumed to own — would turn one college's configuration into the product's
 * definition of the seat.
 *
 * An area's own screen states what it is and which departments it covers. It
 * carries no decisions: the only thing routed to this seat is what its workflow
 * chain routes, which lives in Routed Approvals.
 */

export function DelegatedWorkAreasView() {
  const navigate = useNavigate();
  const scope = delegatedScope();

  return (
    <div className={PANE}>
      <DelegatedScopeHeader scope={scope} trail="Work areas" />
      <h1 className="flex-none m-0 mb-[12px] text-[17px] font-[600] tracking-[-.01em]">Work areas</h1>

      <StickyTableShell>
        {scope.workAreas.length === 0 ? (
          <NoAssignedScope />
        ) : (
          <ul className="m-0 p-0 list-none">
            {scope.workAreas.map((area) => (
              <li key={area.id}>
                <button
                  type="button"
                  onClick={() => navigate(`${DELEGATED_ROOT}/areas/${area.id}`)}
                  className="w-full grid grid-cols-[1fr_auto] gap-x-[12px] items-center px-[16px] py-[11px] border-0 border-t border-line-light bg-transparent text-left cursor-pointer transition-colors duration-200 hover:bg-tint2 first:border-t-0"
                >
                  <span className="min-w-0">
                    <span className="block text-[13px] text-ink truncate">{area.label}</span>
                    <span className="block mt-[2px] text-[11.5px] text-ink-faint">{area.note}</span>
                  </span>
                  <ChevronRight size={15} strokeWidth={2} aria-hidden="true" className="text-ink-faint" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </StickyTableShell>
    </div>
  );
}

export function DelegatedWorkAreaDetail() {
  const { areaId } = useParams();
  const scope = delegatedScope();
  const area = delegatedWorkArea(areaId, scope);

  if (!area) {
    return (
      <div className={PANE}>
        <DelegatedScopeHeader scope={scope} trail="Work areas" />
        <StickyTableShell>
          <NoResults what="work areas" />
        </StickyTableShell>
      </div>
    );
  }

  return (
    <div className={PANE}>
      <DelegatedScopeHeader scope={scope} trail={area.label} />
      <h1 className="flex-none m-0 mb-[3px] text-[17px] font-[600] tracking-[-.01em]">{area.label}</h1>
      <p className="flex-none m-0 mb-[12px] text-[12px] text-ink-muted">{area.note}</p>

      <StickyTableShell>
        <div className="px-[16px] py-[12px]">
          <div className={TABLE_HEAD}>Covers</div>
        </div>
        {scope.departments.length === 0 ? (
          <NoAssignedScope />
        ) : (
          <ul className="m-0 p-0 list-none">
            {scope.departments.map((d) => {
              const dept = DEPARTMENT_BY_ID[d.id];
              return (
                <li
                  key={d.id}
                  className="grid grid-cols-[1fr_auto] gap-x-[12px] items-center px-[16px] py-[10px] border-t border-line-light"
                >
                  <span className="text-[13px] text-ink truncate">{d.name}</span>
                  <span className="text-[11.5px] text-ink-faint tabular-nums">
                    {dept ? `${dept.classCount} classes · ${dept.studentCount} students` : '—'}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </StickyTableShell>
    </div>
  );
}
