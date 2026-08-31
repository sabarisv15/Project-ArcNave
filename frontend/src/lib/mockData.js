export const CHATS = [
  /* A deliberately long reply, kept in the seed set so reply density can be
     judged against real content — headings, paragraphs, both list types, a
     table and a code block in one response, not a three-line demo answer. */
  { id: 'c0', title: 'Walk me through the full mid-semester academic review', kind: 'chat', meta: '20 minutes ago' },
  {
    id: 'c1',
    title: 'Create an attendance summary for second-year CSE students this week',
    kind: 'chat',
    meta: '2 hours ago',
  },
  {
    id: 'c2',
    title: 'Identify students with low internal marks and attendance patterns',
    kind: 'chat',
    meta: 'Yesterday',
  },
  {
    id: 'c3',
    title: 'Summarize faculty workload distribution for the current academic week',
    kind: 'project',
    project: 'CSE Department Review',
    projectId: 'p3',
    meta: 'Yesterday',
  },
  { id: 'c4', title: 'Draft a reminder notice for pending semester fee payments', kind: 'chat', meta: '2 days ago' },
  {
    id: 'c5',
    title: 'Generate a parent meeting list for students needing academic support',
    kind: 'chat',
    meta: '3 days ago',
  },
  {
    id: 'c6',
    title: 'Prepare a department report for the upcoming principal review',
    kind: 'project',
    project: 'NAAC Cycle 4 Documentation',
    projectId: 'p1',
    meta: 'Last week',
  },
  {
    id: 'c7',
    title: 'Compare internal assessment results across the three CSE sections',
    kind: 'chat',
    meta: 'Last week',
  },
];

export const PROJECTS = [
  {
    id: 'p1',
    title: 'NAAC Cycle 4 Documentation',
    desc: 'Assemble criterion-wise evidence, verify data sheets and prepare the self-study submission.',
    updated: 'Updated 2 hours ago',
    count: '14 files',
    pinned: true,
  },
  {
    id: 'p2',
    title: 'Semester Preparation',
    desc: 'Timetables, lab allocations and course plans for the odd semester.',
    updated: 'Updated yesterday',
    count: '9 files',
    pinned: false,
  },
  {
    id: 'p3',
    title: 'CSE Department Review',
    desc: 'Faculty workload, results analysis and improvement actions for the principal review.',
    updated: 'Updated 2 days ago',
    count: '6 files',
    pinned: false,
  },
  {
    id: 'p4',
    title: 'Placement Drive 2027',
    desc: 'Company coordination, student readiness tracking and training schedules.',
    updated: 'Updated 4 days ago',
    count: '11 files',
    pinned: false,
  },
  {
    id: 'p5',
    title: 'Academic Calendar 2026–27',
    desc: 'Term dates, examination windows and institutional events.',
    updated: 'Updated last week',
    count: '4 files',
    pinned: false,
  },
  {
    id: 'p6',
    title: 'Student Support Follow-up',
    desc: 'Mentoring records for students flagged on attendance and internal marks.',
    updated: 'Updated last week',
    count: '7 files',
    pinned: false,
  },
];

export const ARTIFACTS = [
  {
    id: 'a1',
    title: 'Semester Fee Reminder Notice',
    type: 'Notice',
    edited: 'Edited 1 hour ago',
    link: 'Academic Calendar 2026–27',
  },
  {
    id: 'a2',
    title: 'CSE Internal Assessment Analysis',
    type: 'Report',
    edited: 'Edited yesterday',
    link: 'CSE Department Review',
  },
  { id: 'a3', title: 'Attendance Follow-up Sheet', type: 'Spreadsheet', edited: 'Edited yesterday', link: '' },
  {
    id: 'a4',
    title: 'NAAC Criterion 2 Summary',
    type: 'Document',
    edited: 'Edited 2 days ago',
    link: 'NAAC Cycle 4 Documentation',
  },
  {
    id: 'a5',
    title: 'Parent Meeting Invitation Draft',
    type: 'Notice',
    edited: 'Edited 3 days ago',
    link: 'Student Support Follow-up',
  },
  {
    id: 'a6',
    title: 'Placement Readiness Dashboard',
    type: 'Dashboard / Analysis',
    edited: 'Edited last week',
    link: 'Placement Drive 2027',
  },
];

export const CONTEXT_FILES = [
  { id: 'f1', name: 'NAAC_Criterion_2_Evidence.pdf', meta: 'PDF · 2.4 MB' },
  { id: 'f2', name: 'CSE_Attendance_2026.xlsx', meta: 'Spreadsheet · 380 KB' },
  { id: 'f3', name: 'Semester_Action_Plan.docx', meta: 'Document · 118 KB' },
];

/** Files shared inside a specific chat — never the project-level context files above. */
export const CHAT_FILES = {
  c1: [{ id: 'cf1', name: 'CSE_Attendance_Week6.xlsx', meta: 'Spreadsheet · 96 KB' }],
  c6: [
    { id: 'cf2', name: 'Principal_Review_Notes.docx', meta: 'Document · 64 KB' },
    { id: 'cf3', name: 'Department_Report_Draft.pdf', meta: 'PDF · 512 KB' },
  ],
};

export const ARTIFACT_TYPES = [
  { key: 'Document', desc: 'A structured academic document with headings and sections.' },
  { key: 'Report', desc: 'An analytical write-up with findings and recommendations.' },
  { key: 'Notice', desc: 'A short circular for students, faculty or parents.' },
  { key: 'Spreadsheet', desc: 'A tabular sheet for marks, attendance or allocations.' },
  { key: 'Presentation', desc: 'A slide outline for reviews and department meetings.' },
  { key: 'Form / Survey', desc: 'A question set for feedback or data collection.' },
  { key: 'Dashboard / Analysis', desc: 'A summarised view of academic performance signals.' },
];

export const IDEAS = [
  {
    title: 'Prepare today’s attendance',
    sub: 'Review incomplete attendance entries and create a follow-up list for each class.',
  },
  {
    title: 'Generate an assessment insight',
    sub: 'Identify students who need support using recent marks, attendance, and assessment patterns.',
  },
  {
    title: 'Create a department notice',
    sub: 'Draft a clear academic notice, then export it as a shareable document.',
  },
];

export const SCHEDULE = [
  { time: '09:15', title: 'CSE Semester 4 — Data Structures', meta: 'Block A · Room 204' },
  { time: '11:00', title: 'Coordination sync with HoDs', meta: 'Conference room · 45 min' },
  { time: '13:30', title: 'NAAC evidence review', meta: 'With Dr. Lakshmi Narayanan' },
  { time: '15:00', title: 'Student mentoring — support list', meta: '6 students scheduled' },
  { time: '16:30', title: 'Semester fee status review', meta: 'Accounts office' },
];

/**
 * What each artifact was **built from** — the uploads, institutional and
 * personal documents and linked records that went into creating it.
 *
 * Deliberately not the artifact's revision chat attachments: a file dropped
 * into the conversation to ask a question about it is not a creation input,
 * and listing it here would make the widget an inventory again. An artifact
 * with no recorded inputs simply has no entry, and the widget does not render.
 */
export const ARTIFACT_CONTEXT = {
  a1: [
    {
      id: 'ac1',
      name: 'Fee Circular — Odd Semester 2026.pdf',
      kind: 'institutional',
      meta: 'Accounts office · Clause 2',
      size: '412 KB',
    },
    { id: 'ac2', name: 'Notice_Template_Institutional.docx', kind: 'personal', meta: 'Your documents', size: '86 KB' },
    { id: 'ac3', name: 'Academic Calendar 2026–27', kind: 'record', meta: 'Linked · Term dates' },
  ],
  a2: [
    { id: 'ac4', name: 'CSE_IA_Marks_2026.xlsx', kind: 'uploaded', meta: 'Uploaded for this artifact', size: '248 KB' },
    { id: 'ac5', name: 'Internal assessment register', kind: 'record', meta: 'Linked · IA-I & IA-II' },
    {
      id: 'ac6',
      name: 'Mentoring Guidelines.pdf',
      kind: 'institutional',
      meta: 'Academic office · Section 2',
      size: '190 KB',
    },
  ],
  a3: [
    {
      id: 'ac7',
      name: 'CSE_Attendance_2026.xlsx',
      kind: 'uploaded',
      meta: 'Uploaded for this artifact',
      size: '380 KB',
    },
    { id: 'ac8', name: 'Attendance Shortfall Policy 2026', kind: 'institutional', meta: 'Academic office · Section 4' },
  ],
  a4: [
    {
      id: 'ac9',
      name: 'NAAC_Criterion_2_Evidence.pdf',
      kind: 'institutional',
      meta: 'NAAC Cycle 4 · Criterion 2',
      size: '2.4 MB',
    },
    { id: 'ac10', name: 'Semester_Action_Plan.docx', kind: 'personal', meta: 'Your documents', size: '118 KB' },
  ],
  a6: [
    {
      id: 'ac11',
      name: 'Placement_Readiness_2027.xlsx',
      kind: 'uploaded',
      meta: 'Uploaded for this artifact',
      size: '512 KB',
    },
    { id: 'ac12', name: 'Training schedule — Placement Drive 2027', kind: 'record', meta: 'Linked · 11 files' },
  ],
  // `a5` deliberately has none — the widget must hide rather than sit empty.
};

export const DOC_PARAGRAPHS = [
  'All students of the second and third year are informed that the semester fee for the odd semester of the academic year 2026–27 must be paid on or before 30 August 2026.',
  'Payments may be made at the accounts counter between 10:00 and 15:00 on working days, or through the institutional payment portal using the registered student number.',
  'Students facing genuine difficulty may approach the academic coordination office before the deadline so that an instalment arrangement can be recorded.',
  'Class teachers are requested to read out this notice during the first period and to record acknowledgement in the class register.',
];

export const CURRICULUM = {
  students: {
    label: 'Students',
    title: 'Students',
    sub: 'Enrolment across departments for the 2026–27 academic year.',
    cols: ['Student', 'Programme', 'Semester', 'Attendance'],
    rows: [
      { a: 'Aarthi Balakrishnan', b: 'B.E. Computer Science', c: 'Semester 4', d: '92%' },
      { a: 'Rohan Deshmukh', b: 'B.E. Computer Science', c: 'Semester 4', d: '68%' },
      { a: 'Meera Vasudevan', b: 'B.E. Electronics', c: 'Semester 6', d: '88%' },
      { a: 'Karthik Subramanian', b: 'B.E. Mechanical', c: 'Semester 4', d: '74%' },
      { a: 'Sneha Iyer', b: 'B.Sc. Mathematics', c: 'Semester 4', d: '95%' },
      { a: 'Vignesh Ramanathan', b: 'B.E. Computer Science', c: 'Semester 6', d: '61%' },
    ],
  },
  attendance: {
    label: 'Attendance',
    title: 'Attendance',
    sub: 'Entries recorded against timetable sessions this week.',
    cols: ['Class', 'Session', 'Recorded by', 'Status'],
    rows: [
      { a: 'CSE Semester 4 — A', b: 'Mon · Period 2', c: 'Prof. Anand Kulkarni', d: 'Complete' },
      { a: 'CSE Semester 4 — B', b: 'Mon · Period 3', c: 'Dr. Lakshmi Narayanan', d: 'Pending' },
      { a: 'ECE Semester 6', b: 'Tue · Period 1', c: 'Dr. Fathima Rasheed', d: 'Complete' },
      { a: 'MECH Semester 4', b: 'Tue · Period 4', c: 'Prof. Girish Menon', d: 'Pending' },
      { a: 'MATH Semester 4', b: 'Wed · Period 2', c: 'Dr. Nandita Roy', d: 'Complete' },
    ],
  },
  assessments: {
    label: 'Assessments',
    title: 'Assessments',
    sub: 'Internal assessments scheduled and evaluated this semester.',
    cols: ['Assessment', 'Course', 'Date', 'Status'],
    rows: [
      { a: 'Internal Assessment II', b: 'Data Structures', c: '14 Aug 2026', d: 'Scheduled' },
      { a: 'Internal Assessment I', b: 'Operating Systems', c: '02 Aug 2026', d: 'Evaluated' },
      { a: 'Lab Continuous Evaluation', b: 'DBMS Laboratory', c: 'Weekly', d: 'Ongoing' },
      { a: 'Model Examination', b: 'Digital Electronics', c: '28 Aug 2026', d: 'Scheduled' },
      { a: 'Seminar Evaluation', b: 'Engineering Mathematics', c: '09 Aug 2026', d: 'Evaluated' },
    ],
  },
  documents: {
    label: 'Documents',
    title: 'Documents',
    sub: 'Institutional records maintained by the coordination office.',
    cols: ['Document', 'Category', 'Updated', 'Owner'],
    rows: [
      { a: 'NAAC Criterion 2 Evidence', b: 'Accreditation', c: '09 Aug 2026', d: 'Priya R.' },
      { a: 'Academic Calendar 2026–27', b: 'Planning', c: '02 Aug 2026', d: 'Priya R.' },
      { a: 'Semester Fee Circular', b: 'Administration', c: '28 Jul 2026', d: 'Accounts' },
      { a: 'Faculty Workload Sheet', b: 'Staffing', c: '05 Aug 2026', d: 'HoD, CSE' },
      { a: 'Placement Readiness Report', b: 'Placements', c: '01 Aug 2026', d: 'Training cell' },
    ],
  },
  calendar: {
    label: 'Calendar',
    title: 'Calendar',
    sub: 'Key academic dates for the current term.',
    cols: ['Event', 'Type', 'Date', 'Scope'],
    rows: [
      { a: 'Internal Assessment II window', b: 'Examination', c: '14–19 Aug', d: 'All departments' },
      { a: 'Parent–teacher meeting', b: 'Engagement', c: '22 Aug', d: 'CSE, ECE' },
      { a: 'NAAC peer team visit', b: 'Accreditation', c: '04 Sep', d: 'Institution' },
      { a: 'Placement drive — round one', b: 'Placements', c: '11 Sep', d: 'Final year' },
      { a: 'Semester fee deadline', b: 'Administration', c: '30 Aug', d: 'All students' },
    ],
  },
};

export const CURRICULUM_ORDER = ['students', 'staff', 'attendance', 'assessments', 'documents', 'calendar'];

export const RECENT_FILTERS = ['All conversations', 'Normal chats', 'Project chats', 'Today', 'This week'];
export const PROJECT_SORTS = ['Last updated', 'Date created', 'Alphabetical', 'Recently opened'];
export const ARTIFACT_FILTERS = [
  'All artifacts',
  'Documents',
  'Reports',
  'Spreadsheets',
  'Dashboards',
  'Notices',
  'Forms and surveys',
  'Generated today',
  'Linked to a project',
];
