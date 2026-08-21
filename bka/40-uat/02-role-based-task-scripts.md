# ARCNAVE — Role-Based UAT Task Scripts

Every task below is backed by a live frontend page and a working API call
as of baseline `v1.0-architecture-conformant`. Do not attempt anything not
listed here — features outside this list have no clickable interface yet
(see the [Master Test Plan](00-uat-master-test-plan.md) §2 exclusion list).

For each task, log a [Feedback Capture Template](03-feedback-capture-template.md)
entry — including when the task went smoothly.

---

## Principal — login `principal`

**P-1. Morning check-in.** Log in. Look at the Dashboard. Without being
told what anything means, say out loud what you think each number/card is
telling you.

**P-2. Admit a new student.** Use the student admission wizard to add a new
CSE student. Try uploading a document (e.g. a photo of any ID) partway
through and see what happens.

**P-3. Review a transfer or lifecycle request.** Open a student's record
and look for any pending status-change request. If none is pending, ask
your observer to have another tester (e.g. HOD) create one, then come back
and approve or reject it.

**P-4. Bring on a new HOD.** Create a new HOD account for a department.

**P-5. Approve something waiting on you.** Open Approvals. Act on anything
in your queue.

**P-6. Set up a new academic year.** Create an academic year and activate
it.

**P-7. Publish an institutional document.** Upload a document (e.g. a
circular) to Institutional Documents and file it under a category.

**P-8. Send a notification.** Draft and send a notification to staff or
students.

**P-9. Generate a report.** Produce any report and export the student list.

**P-10. Ask the AI Workspace something.** Ask it a real question you'd
actually want answered about your college's data (e.g. attendance,
students below a threshold).

**P-11. Check institution settings.** Open College Profile and
Configurations. Note anything you'd expect to be able to change that you
can't.

---

## HOD — login `hod.cse`

**H-1. Morning check-in.** Log in, look at the Dashboard from your
department's point of view.

**H-2. Bring on a new teacher.** Invite a new staff member to your
department.

**H-3. Assign a Class Tutor.** Find a class in your department and assign
or change its Class Tutor.

**H-4. Handle a substitute request.** Create a substitute-teacher
assignment request for a class in your department.

**H-5. Approve something waiting on you.** Open Approvals — act on any
staff registration, substitute assignment, or correction request routed to
you.

**H-6. Edit a student directly.** Open a student in your department and
edit their record.

**H-7. Check attendance in your department.** View attendance for a class
in CSE.

**H-8. Publish a department document.** Upload a document to Institutional
Documents.

**H-9. Ask the AI Workspace something department-scoped.** Ask a question
and confirm the answer only reflects your department's data, not the whole
college.

---

## Class Tutor — login `tutor.cse3a` (CSE-3A, timetable Approved)

**CT-1. Morning check-in.** Log in, look at the Dashboard.

**CT-2. Mark attendance.** Mark today's attendance for CSE-3A.

**CT-3. Mark a fee payment.** Open a CSE-3A student's record, go to the
Finance tab, and mark their fee status.

**CT-4. Try to correct an attendance mistake.** After marking attendance,
try to fix a mistake you made. Note how far you can get and where you get
stuck, if anywhere.

**CT-5. Check your class's timetable.** Open your class detail page and
review the timetable.

**CT-6. Ask the AI Workspace about your class.** Ask which students in your
class have low attendance.

---

## Class Tutor (blocked case) — login `tutor.cse3b` (CSE-3B, timetable Pending HOD)

**CT2-1. Try to mark attendance.** Attempt to mark attendance for CSE-3B.
Expected: this should be blocked or unavailable, because the timetable is
not yet Approved. Record exactly what you see — a clear explanation, a
generic error, or something that looks broken.

**CT2-2. Everything else a tutor can do.** Repeat CT-3, CT-5, CT-6 above
for CSE-3B and confirm they behave the same as for CSE-3A.

---

## Staff / Office — login `staff.ece`

**S-1. Morning check-in.** Log in, look at the Dashboard from a regular
faculty point of view.

**S-2. Try the admission wizard.** Attempt to admit a new ECE student.
Expected: this should be blocked or unavailable — plain Staff cannot
admit students, only the Class Tutor of that class can. Record exactly
what you see.

**S-3. Look up a colleague.** Find another staff member's profile using
the Staff list.

**S-4. Check your teaching schedule.** Open Academic Overview / your class
detail and find your own allocated periods.

**S-5. Mark attendance for a class you teach.** Attempt this for a class
you are allocated to. If you are not allocated to any period on the
Approved class, note that clearly instead of guessing.

**S-6. Upload an institutional document.** Upload any document to
Institutional Documents.

**S-7. Export a report.** Use the student export feature.

**S-8. Ask the AI Workspace a routine question.** Ask something you'd
realistically ask day-to-day.

---

## Notes for observers

- Do not explain a screen before the tester has tried it unassisted.
- If a tester is fully stuck for more than ~2 minutes, note that as a
  finding first, then help.
- "Office/Admin staff" maps to the `staff.ece` login in this environment —
  brief the tester that some institution-wide settings (college profile,
  configurations) are Principal-only by design, not a bug.
