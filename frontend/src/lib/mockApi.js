import { CHATS, PROJECTS, ARTIFACTS, CONTEXT_FILES } from './mockData';

/** Mock "server" state used through TanStack Query. No real network. */
const delay = (ms) => new Promise((r) => setTimeout(r, ms));

export const queryKeys = {
  chats: ['chats'],
  threads: ['threads'],
  projects: ['projects'],
  artifacts: ['artifacts'],
  contextFiles: ['context-files'],
};

export async function fetchChats() {
  await delay(0);
  return CHATS;
}
export async function fetchProjects() {
  await delay(0);
  return PROJECTS;
}
export async function fetchArtifacts() {
  await delay(0);
  return ARTIFACTS;
}
export async function fetchContextFiles() {
  await delay(0);
  return CONTEXT_FILES;
}

/**
 * The references a reply actually used.
 *
 * `kind` decides the glyph and the wording — `uploaded` is specifically a file
 * attached to this conversation, and is only ever listed when the reply
 * genuinely drew on it (see `usesAttachments` below). A source the signed-in
 * user may not open is not returned at all, rather than returned and disabled:
 * the existence of a document is itself information.
 */
const SOURCE_KINDS = ['uploaded', 'institutional', 'personal', 'web', 'record'];
export { SOURCE_KINDS };

/** Mock ArcNave response, matching the prototype's contextual replies exactly. */
export function generateReply(text, kind) {
  const t = (text || '').toLowerCase();
  /*
   * Whether this reply leaned on what the user attached. Deliberately a
   * property of the *answer*, not of the upload: attaching six screenshots and
   * asking an unrelated question must not produce six sources.
   */
  const usesAttachments = /image|screenshot|photo|attached|attachment|this file|scan/.test(t);

  /*
   * The long-form reply. It exists so reply density can be judged against
   * something the renderer actually has to work at — every block type in one
   * response, roughly fifty rendered lines — rather than against a three-line
   * answer where any spacing scale looks fine.
   */
  if (/mid-semester academic review|full academic review|walk me through the full/.test(t))
    return {
      usesAttachments,
      sources: [
        {
          id: 'src-review-ledger',
          title: 'Attendance ledger — Weeks 1–8',
          kind: 'record',
          origin: 'All departments',
          detail: '5,840 timetabled sessions',
        },
        {
          id: 'src-review-ia',
          title: 'Internal assessment marks — IA-I & IA-II',
          kind: 'record',
          origin: 'Assessment register · 2026',
        },
        {
          id: 'src-review-policy',
          title: 'Mid-Semester Review Policy 2026',
          kind: 'institutional',
          origin: 'Academic office',
          detail: 'Sections 3–6',
        },
        {
          id: 'src-review-calendar',
          title: 'Academic Calendar 2026–27',
          kind: 'personal',
          origin: 'Your documents',
        },
        {
          id: 'src-review-ugc',
          title: 'Minimum instructional days per semester',
          kind: 'web',
          href: 'https://www.ugc.gov.in/',
        },
      ],
      status: 'Compiling the mid-semester review…',
      body:
        'Week 8 of 16 closed on Friday, so the review covers exactly half the semester across all five departments.\n\n' +
        '## Attendance\n\n' +
        'Of 5,840 timetabled sessions, 5,402 carry complete entries — 92.5%, against a 95% institutional target.\n\n' +
        '- **CSE** — 96.1% complete. Two sections short on lab periods only.\n' +
        '- **ECE** — 94.8% complete. Consistent, no open corrections.\n' +
        '- **Mechanical** — 88.2% complete. Weeks 3 and 6 account for most of the shortfall.\n' +
        '- **Civil** — 91.4% complete. Four periods still unlocked from Week 7.\n' +
        '- **IT** — 92.0% complete. One substitute chain unacknowledged.\n\n' +
        '| Department | Sessions | Complete | Below 75% |\n' +
        '| --- | --- | --- | --- |\n' +
        '| CSE | 1,320 | 96.1% | 14 |\n' +
        '| ECE | 1,180 | 94.8% | 9 |\n' +
        '| Mechanical | 1,240 | 88.2% | 31 |\n' +
        '| Civil | 1,100 | 91.4% | 22 |\n' +
        '| IT | 1,000 | 92.0% | 12 |\n\n' +
        '### Students below the threshold\n\n' +
        '88 students are under 75% overall, and 34 of them have been under it for three consecutive weeks — that second group is the one the shortfall notice is actually for.\n\n' +
        '## Internal assessment\n\n' +
        'IA-I and IA-II are both published for every department. Comparing the two:\n\n' +
        '1. **Mean improved** in three departments — CSE +3.2, ECE +1.8, IT +2.4 marks.\n' +
        '2. **Mean declined** in two — Mechanical −4.1, Civil −1.6.\n' +
        '3. **Correlation with attendance** holds at 0.62 across the cohort, and 0.71 once the sub-75% group is isolated.\n\n' +
        'Data Structures, Thermodynamics and Digital Electronics account for most of the decline.\n\n' +
        '### Subjects needing intervention\n\n' +
        '- Thermodynamics (Mechanical, S3) — 41% below passing in IA-II.\n' +
        '- Data Structures (CSE, S3) — 28% below passing, improving since the extra tutorial.\n' +
        '- Digital Electronics (ECE, S3) — 24% below passing, flat across both assessments.\n\n' +
        '## Faculty workload\n\n' +
        'Average load is 17.4 hours a week against a 18-hour norm, but the spread matters more than the mean:\n\n' +
        '- Six staff are above 22 hours, all in Mechanical and Civil.\n' +
        '- Nine are under 12 hours, mostly first-year handling staff.\n' +
        '- Substitute coverage absorbed 214 periods, 61% of them in two departments.\n\n' +
        '## Timetable and calendar\n\n' +
        '> Instructional days completed: 78 of 90. The remaining 12 fit the calendar only if no further holidays are declared this term.\n\n' +
        'Two departments have unapproved timetable revisions pending, which blocks attendance marking for the affected periods:\n\n' +
        '```\nMechanical  Revised v2   pending HOD approval   4 periods blocked\nCivil       Revised v1   pending HOD approval   2 periods blocked\n```\n\n' +
        '## What I would do next\n\n' +
        '1. Clear the two pending timetable approvals — everything else is blocked behind them.\n' +
        '2. Issue shortfall notices to the 34 repeat cases, not all 88.\n' +
        '3. Schedule remedial sessions for the three subjects above.\n' +
        '4. Rebalance the six overloaded staff before the second half begins.',
      closing: 'I can turn any one of those four into a document, or start with the shortfall notices.',
    };

  if (/attendance/.test(t))
    return {
      usesAttachments,
      sources: [
        {
          id: 'src-att-ledger',
          title: 'Attendance ledger — Week 32',
          kind: 'record',
          origin: 'Second-year CSE · Sections A–C',
          detail: '468 timetabled sessions',
        },
        {
          id: 'src-att-policy',
          title: 'Attendance Shortfall Policy 2026',
          kind: 'institutional',
          origin: 'Academic office',
          detail: 'Section 4 — 75% threshold',
        },
        {
          id: 'src-aicte-attendance',
          title: 'Minimum attendance for award of degree',
          kind: 'web',
          href: 'https://www.aicte-india.org/',
        },
      ],
      status: 'Reviewing attendance patterns…',
      body:
        'Across the second-year CSE sections, 412 of 468 timetabled sessions have complete attendance entries for this week.\n\n' +
        '- Section B is missing Monday period 3 and Wednesday period 1 entries.\n' +
        '- 9 students are below the 75% threshold, 4 of them for a second consecutive week.\n' +
        '- Lab attendance is complete across all three sections.',
      closing: 'I can turn this into a follow-up list for each class teacher, or draft the shortfall notice.',
    };
  if (/notice|circular|fee|reminder/.test(t))
    return {
      usesAttachments,
      sources: [
        {
          id: 'src-fee-circular',
          title: 'Fee Circular — Odd Semester 2026',
          kind: 'institutional',
          origin: 'Accounts office',
          detail: 'Clause 2 — late fee schedule',
        },
        {
          id: 'src-fee-template',
          title: 'Notice template (institutional tone)',
          kind: 'personal',
          origin: 'Your documents',
        },
      ],
      status: 'Drafting the artifact structure…',
      body:
        '## Draft notice\n\n' +
        'Drafted in institutional-circular tone — deadline, payment channels and escalation point, without sounding punitive.\n\n' +
        '1. **Subject line** — Reminder: Semester Fee Payment Due **30 August 2026**.\n' +
        '2. **Body** — deadline, late fee, and counter timings.\n' +
        '3. **Closing** — directs queries to the accounts office.\n\n' +
        '> Late fee applies from the day after the due date, at the rate set in the circular.',
      closing: 'Say the word and I will save this as a Notice artifact you can export.',
    };
  if (/marks|assessment|result|support/.test(t))
    return {
      usesAttachments,
      sources: [
        {
          id: 'src-ia-marks',
          title: 'Internal assessment marks — IA-I & IA-II',
          kind: 'record',
          origin: 'Assessment register · CSE 2026',
        },
        {
          id: 'src-mentoring',
          title: 'Mentoring Guidelines',
          kind: 'institutional',
          origin: 'Academic office',
          detail: 'Section 2 — early intervention',
        },
      ],
      status: 'Analysing assessment signals…',
      body:
        '### What the numbers show\n\n' +
        'Combining internal marks, attendance and assessment trends, **17 students** in the current cohort show a consistent decline over the last two evaluations.\n\n' +
        '- 6 students dropped more than 12 marks between IA-I and IA-II.\n' +
        '- 11 of the 17 also fall below 70% attendance.\n' +
        '- Data Structures and Digital Electronics account for most of the decline.',
      closing: 'I can prepare the mentoring list grouped by class teacher.',
    };
  if (kind === 'project')
    return {
      usesAttachments,
      sources: [
        {
          id: 'src-proj-context',
          title: 'Project context files',
          kind: 'personal',
          origin: 'This project',
          detail: '3 documents updated this week',
        },
      ],
      status: 'Preparing the project context…',
      body:
        'Three project documents changed this week, and two evidence gaps still block submission.\n\n' +
        '- Three of the referenced documents were updated in the last week.\n' +
        '- Two evidence gaps remain before the submission is complete.\n' +
        '- A consolidated summary can be generated as an artifact.',
      closing: 'Tell me which thread to expand and I will draft it in full.',
    };
  return {
    usesAttachments,
    sources: [
      {
        id: 'src-academic-records',
        title: 'Academic records — current semester',
        kind: 'record',
        origin: 'Five departments',
      },
    ],
    status: 'Thinking through your request…',
    body:
      'The current academic records cover this across five departments, with two items still unconfirmed.\n\n' +
      '- The relevant data spans the current semester across five departments.\n' +
      '- Two items need confirmation before anything is circulated.\n' +
      '- Everything can be exported as a shareable document.',
    closing: 'Would you like this as a draft artifact, or as a short summary to share?',
  };
}

export const GENERATION_DELAY = 1300;
