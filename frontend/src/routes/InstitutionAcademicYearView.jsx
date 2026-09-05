import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronRight, Lock } from 'lucide-react';
import { COMMENCEMENT_CONSEQUENCES, NO_ACTIVE_TERM, TERM_STATES } from '../lib/academicTerm';
import { bandLabel } from '../lib/academicCalendar';
import { InstitutionScopeHeader } from '../components/InstitutionScopeHeader';
import { CommenceSemesterDialog } from '../components/CommenceSemesterDialog';
import { InstitutionDelegatedSummary } from '../components/InstitutionDelegatedSummary';
import { PANE, TABLE_HEAD } from '../components/WorkspaceLayout';
import { useAcademicTerm } from '@/features/institution';
import { useInstitutionHealth } from '../hooks/useInstitutionHealth';
import { cn } from '../lib/utils';

/**
 * Institution → Academic Year.
 *
 * **This seat's alone, and it is one act rather than a calendar.** There is no
 * scheduler here, no term builder and no date grid: an institution head does not
 * assemble an academic year in this product, they commence the next semester of
 * one, and everything else on this page exists to say what that will do and what
 * it did. Building a calendar application inside a governance screen would be
 * building the wrong thing carefully.
 *
 * **The four states are real states, not tabs.** A year is draft, active or
 * completed, or there is no year at all — and the last of those is the absence
 * of a term rather than a term in a state, which is why it renders as its own
 * reading with no band, no classes and no commence action.
 *
 * **The consequences are shown before and after.** The same eight facts the
 * confirmation dialog states are what the "what commencing does" list explains
 * here, from one source — so a reader who cancelled the dialog can still find
 * out what it was going to do.
 */

function Badge({ tone, children }) {
  return (
    <span className={cn('inline-flex items-center h-[20px] px-[7px] rounded-[6px] text-[11px] font-[500]', tone)}>
      {children}
    </span>
  );
}

function Metric({ label, value, caption }) {
  return (
    <div className="flex-1 min-w-[152px] bg-paper border border-line rounded-[16px] px-[14px] py-[12px] shadow-[inset_2px_0_0_rgb(var(--c-accent-line))]">
      <div className={TABLE_HEAD}>{label}</div>
      <div className="mt-[6px] text-[20px] font-[600] tracking-[-.01em] tabular-nums text-ink">{value}</div>
      <div className="mt-[3px] text-[12px] text-ink-faint">{caption}</div>
    </div>
  );
}

function Section({ title, children, action }) {
  return (
    <section className="bg-paper border border-line rounded-[16px] overflow-hidden">
      <header className="flex items-center gap-[8px] h-[40px] px-[14px] bg-mist border-b border-line">
        <h2 className="m-0 text-[12.5px] font-[600] text-ink">{title}</h2>
        <div className="flex-1" />
        {action}
      </header>
      {children}
    </section>
  );
}

export function InstitutionAcademicYearView() {
  const navigate = useNavigate();
  const { term, priorTerms, semesters, yearActive } = useAcademicTerm();
  const { readiness } = useInstitutionHealth();
  const [confirming, setConfirming] = useState(false);

  const state = TERM_STATES[term?.state] ?? NO_ACTIVE_TERM;

  return (
    <div className={cn(PANE, 'overflow-auto scroll-quiet')}>
      <InstitutionScopeHeader trail="Academic Year" />

      <div className="flex-none flex items-center gap-[8px] flex-wrap mb-[14px]">
        <h1 className="m-0 text-[17px] font-[600] tracking-[-.01em]">Academic Year</h1>
        <Badge tone={state.tone}>{state.label}</Badge>
        <div className="flex-1" />
        {/*
          The only control on the page, and it opens a confirmation rather than
          acting. It is absent entirely when there is no active year: there is no
          term to commence *from*, and a disabled button would imply there was.
        */}
        {yearActive && (
          <button
            type="button"
            onClick={() => setConfirming(true)}
            className="flex-none h-[30px] px-[13px] border-0 rounded-[9px] bg-accent font-sans text-[12.5px] font-[500] text-white cursor-pointer transition-colors duration-200 hover:bg-accent-hover"
          >
            Commence next semester
          </button>
        )}
      </div>

      <div className="flex-none flex flex-wrap gap-[10px] mb-[10px]">
        <Metric label="Academic year" value={term?.yearLabel ?? '—'} caption={state.hint} />
        <Metric
          label="Active band"
          value={term ? bandLabel(term.band) : '—'}
          caption={
            semesters.length > 0
              ? `Semesters ${semesters.join(', ')} · nothing below 3 exists in ArcNave`
              : 'No band is running'
          }
        />
        <Metric
          label="Active classes"
          value={readiness.scale.classCount}
          caption="One Class Tutor seat each, derived"
        />
        <Metric
          label="Attendance live"
          value={`${readiness.attendance.live} of ${readiness.attendance.total}`}
          caption="Follows an approved timetable, never a setting"
        />
      </div>

      <div className="flex-none grid grid-cols-1 lg:grid-cols-2 lg:items-start gap-[10px] pb-[28px]">
        <Section title="What commencing the next semester does">
          <ol className="m-0 p-0 list-none">
            {COMMENCEMENT_CONSEQUENCES.map((c, i) => (
              <li
                key={c.key}
                className="grid grid-cols-[22px_1fr] gap-x-[10px] px-[14px] py-[9px] border-t border-line-light first:border-t-0"
              >
                <span
                  aria-hidden="true"
                  className="mt-[1px] h-[20px] w-[20px] grid place-items-center rounded-full bg-tint2 text-[11px] font-[500] tabular-nums text-ink-muted"
                >
                  {i + 1}
                </span>
                <span className="min-w-0">
                  <span className="block text-[13px] text-ink">{c.title}</span>
                  <span className="block mt-[2px] text-[11.5px] text-ink-faint">{c.detail}</span>
                </span>
              </li>
            ))}
          </ol>
        </Section>

        <div className="flex flex-col gap-[10px]">
          {/*
            Where the term's own work currently stands. Both rows are other
            seats' work, reported: this office reads how far promotion review and
            timetable approval have got and decides neither.
          */}
          <Section
            title="This term"
            action={
              <button
                type="button"
                onClick={() => navigate('/institution/timetable')}
                className="inline-flex items-center gap-[3px] border-0 bg-transparent p-0 font-sans text-[12px] font-[500] text-accent cursor-pointer hover:underline"
              >
                Timetable
                <ChevronRight size={13} strokeWidth={2} aria-hidden="true" />
              </button>
            }
          >
            <dl className="m-0 px-[14px] py-[4px]">
              <Row
                label="Class Tutor seats"
                value={readiness.seats.tutor.summary}
                hint="Assigned by each head of department, never from this office"
              />
              <Row
                label="Promotion review"
                value={
                  readiness.promotion.total === 0
                    ? 'No students awaiting a decision'
                    : `${readiness.promotion.reviewed} of ${readiness.promotion.total} decisions recorded`
                }
                hint="Each outcome is confirmed by the department head, one student at a time"
              />
              <Row
                label="Timetables approved"
                value={`${readiness.timetable.settled} of ${readiness.timetable.total} classes`}
                hint="A revision in review never replaces a live grid"
              />
            </dl>
          </Section>

          <InstitutionDelegatedSummary />
        </div>

        <div className="lg:col-span-2">
          <Section title="Previous terms">
            {priorTerms.length === 0 ? (
              <p className="m-0 px-[14px] py-[12px] text-[13px] text-ink-muted">
                No term has closed in this session. A term that closes stays here, readable and unchangeable.
              </p>
            ) : (
              <ul className="m-0 p-0 list-none">
                {priorTerms.map((t) => (
                  <li
                    key={t.id}
                    className="flex flex-wrap items-center gap-[9px] px-[14px] py-[10px] border-t border-line-light first:border-t-0"
                  >
                    <Lock size={13} strokeWidth={1.9} aria-hidden="true" className="flex-none text-ink-faint" />
                    <span className="text-[13px] text-ink">{t.yearLabel}</span>
                    <span className="text-[12.5px] text-ink-muted">{bandLabel(t.band)}</span>
                    <Badge tone={TERM_STATES.completed.tone}>{TERM_STATES.completed.label}</Badge>
                    <span className="min-w-0 flex-1 text-[11.5px] text-ink-faint">
                      Read-only · its students, rosters and records cannot be changed by anyone
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Section>
        </div>
      </div>

      <CommenceSemesterDialog open={confirming} onOpenChange={setConfirming} />
    </div>
  );
}

function Row({ label, value, hint }) {
  return (
    <div className="grid grid-cols-[150px_1fr] gap-x-[12px] items-baseline py-[8px] border-t border-line-light first:border-t-0">
      <dt className="text-[12px] text-ink-muted">{label}</dt>
      <dd className="m-0 text-[13px] text-ink">
        {value}
        {hint && <span className="block mt-[1px] text-[11.5px] text-ink-faint">{hint}</span>}
      </dd>
    </div>
  );
}
