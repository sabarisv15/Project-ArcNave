import { Lock } from 'lucide-react';
import { PRIOR_SEMESTER } from '../lib/classTutorData';
import { TABLE_HEAD } from './WorkspaceLayout';

/**
 * What the previous semester closed on.
 *
 * **Historical and read-only, and it has to look like it.** When a semester is
 * commenced the previous one does not disappear — attendance, assessments,
 * documents and the audit trail all stay readable — but nothing in it can be
 * changed. A panel that rendered last term's figures in the same visual
 * language as this term's would invite a tutor to act on a closed record.
 *
 * So it is a distinctly quieter surface than the current-semester metrics
 * above it: the `tint` grouped background rather than paper, muted figures, a
 * lock glyph, and **no control of any kind** — no drill-through, no export, no
 * row that opens anything. The one sentence it adds is the one that connects
 * the two terms: how many of this class's students arrived by promotion out of
 * that cohort.
 */
export function PriorSemesterPanel({ prior = PRIOR_SEMESTER }) {
  if (!prior) return null;

  return (
    <section
      aria-label="Previous semester"
      className="flex-none bg-tint border border-line rounded-[16px] px-[14px] py-[12px]"
    >
      <header className="flex items-center gap-[7px]">
        <Lock size={13} strokeWidth={1.9} aria-hidden="true" className="text-ink-faint" />
        <h2 className={TABLE_HEAD}>
          {prior.label} · AY {prior.academicYear}
        </h2>
        <span className="text-[11px] text-ink-faint">Closed {prior.closedOn} · read-only</span>
      </header>

      <div className="mt-[9px] flex items-baseline gap-[22px] flex-wrap">
        <Figure label="Students" value={prior.studentCount} />
        <Figure label="Class attendance" value={`${prior.attendance}%`} />
        <Figure label="Assessments published" value={prior.assessmentsPublished} />
      </div>

      <p className="m-0 mt-[9px] text-[12px] text-ink-muted">
        {prior.promotedIn} of this class arrived by promotion from that cohort. Their attendance,
        assessments and documents from it stay on their record and cannot be changed here.
      </p>
    </section>
  );
}

function Figure({ label, value }) {
  return (
    <div>
      <div className="text-[15px] font-[500] text-ink-soft tabular-nums">{value}</div>
      <div className="mt-[1px] text-[11.5px] text-ink-faint">{label}</div>
    </div>
  );
}
