import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { ME, canPublish, initialAssessments, isValidMark, scopeById, studentsForScope } from '../lib/assessmentsData';
import { ACTIVE_VERSION_ID } from '@/lib/timetableData';

const AssessmentsContext = createContext(null);

/**
 * Assessment state for the Curriculum → Assessments route.
 *
 * Two rules are enforced here rather than in the UI, so a stale screen (or a
 * direct call) cannot get around them:
 *
 *  1. **Scope.** Every create resolves its scope through `scopeById()`, which
 *     only knows the staff member's own allocations in the active approved
 *     timetable. An unknown scope is refused outright — designation and
 *     seniority are not consulted anywhere, because they are not what grants
 *     the right.
 *  2. **Publication.** Marks are only visible to the Class Tutor once
 *     published, so `classTutorView()` reads exclusively from published
 *     assessments. A draft's marks are structurally unreachable from it —
 *     that is the integration boundary the Class Tutor screen will later read,
 *     and it is why a draft can never leak.
 *
 * Published marks are read-only to direct entry; changing them is refused and
 * left for a later controlled correction flow.
 */
export function AssessmentsProvider({ children }) {
  const [assessments, setAssessments] = useState(() => initialAssessments());

  const patch = useCallback((id, updater) => {
    setAssessments((prev) => prev.map((a) => (a.id === id ? { ...a, ...updater(a) } : a)));
  }, []);

  const createAssessment = useCallback((draft) => {
    const scope = scopeById(draft.scopeId);
    if (!scope) {
      toast.error('You can only assess subjects and classes from your own timetable.');
      return null;
    }
    const now = new Date();
    const assessment = {
      id: `as-${now.getTime()}`,
      name: draft.name.trim(),
      type: draft.type,
      scopeId: scope.id,
      classKey: scope.classKey,
      subject: scope.subject,
      code: scope.code,
      programme: scope.programme,
      section: scope.section,
      date: draft.date,
      maxMarks: draft.maxMarks,
      instructions: draft.instructions ?? '',
      status: 'draft',
      marks: {},
      timetableVersionId: scope.versionId ?? ACTIVE_VERSION_ID,
      timetableScopeRef: scope.id,
      createdBy: ME.name,
      createdAt: now,
      publishedBy: null,
      publishedAt: null,
    };
    setAssessments((prev) => [assessment, ...prev]);
    toast(draft.saveAsDraft ? 'Assessment saved as draft' : 'Assessment created');
    return assessment;
  }, []);

  const updateAssessment = useCallback(
    (id, fields) => {
      patch(id, (a) => {
        if (a.status === 'published') return {};
        return { ...fields };
      });
    },
    [patch],
  );

  /** Quiet autosave for one student's mark — no toast per keystroke. */
  const setMark = useCallback(
    (id, studentId, entry) => {
      patch(id, (a) => {
        if (a.status === 'published') return {};
        const marks = { ...a.marks };
        if (entry === null) delete marks[studentId];
        else marks[studentId] = entry;
        return { marks, marksSavedAt: new Date() };
      });
    },
    [patch],
  );

  const publishAssessment = useCallback((id) => {
    let ok = false;
    setAssessments((prev) =>
      prev.map((a) => {
        if (a.id !== id) return a;
        const students = studentsForScope(scopeById(a.scopeId));
        if (!canPublish(a, students)) return a;
        ok = true;
        return { ...a, status: 'published', publishedBy: ME.name, publishedAt: new Date() };
      }),
    );
    if (ok) toast('Marks published. They are now available in Class Tutor view');
    else toast.error('Every student needs a valid mark before you can publish.');
    return ok;
  }, []);

  const deleteAssessment = useCallback((id) => {
    setAssessments((prev) => prev.filter((a) => a.id !== id || a.status === 'published'));
    toast('Draft assessment deleted');
  }, []);

  /**
   * The Class Tutor integration boundary. The Class Tutor screen isn't built
   * yet; this is the exact shape it will read, and it is derived from
   * published assessments only — draft marks cannot appear here by
   * construction rather than by a filter someone might forget.
   */
  const classTutorView = useCallback(
    () =>
      assessments
        .filter((a) => a.status === 'published')
        .map((a) => ({
          assessmentId: a.id,
          name: a.name,
          type: a.type,
          subject: a.subject,
          classCode: a.code,
          date: a.date,
          maxMarks: a.maxMarks,
          publishedBy: a.publishedBy,
          publishedAt: a.publishedAt,
          timetableVersionId: a.timetableVersionId,
          marks: a.marks,
        })),
    [assessments],
  );

  const value = useMemo(
    () => ({
      assessments,
      createAssessment,
      updateAssessment,
      setMark,
      publishAssessment,
      deleteAssessment,
      classTutorView,
      isValidMark,
    }),
    [assessments, createAssessment, updateAssessment, setMark, publishAssessment, deleteAssessment, classTutorView],
  );

  return <AssessmentsContext.Provider value={value}>{children}</AssessmentsContext.Provider>;
}

export function useAssessmentsStore() {
  const ctx = useContext(AssessmentsContext);
  if (!ctx) throw new Error('useAssessmentsStore must be used inside AssessmentsProvider');
  return ctx;
}
