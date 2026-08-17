import { toast } from 'sonner';
import { COMMENCEMENT_CONSEQUENCES, nextTermAfter } from '../lib/academicTerm';
import { bandLabel } from '../lib/academicCalendar';
import { ConfirmConsequenceDialog } from './ConfirmConsequenceDialog';
import { TERM_REJECTION, useAcademicTerm } from '../store/AcademicTermProvider';

/**
 * Commencing the next semester, and the eight things it does.
 *
 * **The confirmation is the decision.** `commenceNextSemester` refuses unless it
 * is told the consequences were confirmed, so this dialog is not a courtesy in
 * front of an action that would happen anyway — it is where the act occurs. That
 * is deliberate: no stray handler, no keyboard shortcut and no future screen can
 * roll a term over without somebody having read what it changes.
 *
 * The consequences themselves come from `academicTerm.js` rather than being
 * written here, so the list the dialog states beforehand is the same list the
 * Academic Year page explains afterwards.
 */
export function CommenceSemesterDialog({ open, onOpenChange, onCommenced }) {
  const { term, commenceNextSemester } = useAcademicTerm();
  const next = nextTermAfter(term);

  function confirm() {
    const result = commenceNextSemester({ confirmed: true });
    if (!result.ok) {
      toast.error(TERM_REJECTION[result.reason] ?? 'The semester could not be commenced.');
      return;
    }
    toast.success(`${result.term.yearLabel} · ${bandLabel(result.term.band)} is now active`);
    onOpenChange(false);
    onCommenced?.(result);
  }

  return (
    <ConfirmConsequenceDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Commence the next semester"
      lede={
        `${term.yearLabel} · ${bandLabel(term.band)} closes and becomes historical. ` +
        `${next.yearLabel} · ${bandLabel(next.band)} becomes the active term.`
      }
      consequences={COMMENCEMENT_CONSEQUENCES}
      confirmLabel="Commence semester"
      cancelLabel="Not yet"
      footnote="Nothing is promoted automatically. Each department reviews its own students."
      onConfirm={confirm}
    />
  );
}
