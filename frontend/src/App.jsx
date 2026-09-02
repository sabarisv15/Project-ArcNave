import { lazy, Suspense } from 'react';
import { Navigate, Outlet, Route, Routes, useParams } from 'react-router-dom';
import { ProtectedRoute } from '@/components/layout/ProtectedRoute';
import { LoginPage } from '@/features/auth/LoginPage';
import { AppShell } from './components/AppShell';
import { HomeView } from './routes/HomeView';
import { AttendanceTabsLayout } from '@/features/attendance';
import { DepartmentGate } from './components/DepartmentGate';
import { InstitutionGate } from './components/InstitutionGate';
import { DelegatedGate, DelegatedNotConfigured } from './components/DelegatedGate';
import { delegatedRegistered } from './lib/delegatedScope';
import { ClassGate } from './components/ClassGate';
import { AssessmentsProvider } from './store/AssessmentsProvider';
import { useAttendanceLifecycle } from '@/features/attendance';
import { AcademicRosterProvider } from './store/AcademicRosterProvider';
import { AcademicTermProvider } from './store/AcademicTermProvider';
import { InstitutionalLifecycleProvider } from './store/InstitutionalLifecycleProvider';
import { Loading } from './components/InstitutionalState';

// Every route view below is a named export, not a default one — React.lazy
// needs a default export from the dynamic import, so this re-wraps each
// module's named export as one. Layout/gate/provider components (AppShell,
// the *Gate components, the store Providers, AttendanceTabsLayout, HomeView
// itself as the landing route) stay eagerly imported above: they are either
// tiny and structural, or needed on effectively every navigation, so lazy-
// loading them would trade a real bundle-size win for a loading flash on the
// most common paths. Everything else here used to ship in the single main
// bundle regardless of which seat/page a visitor ever opened.
const lazyNamed = (importer, name) => lazy(() => importer().then((m) => ({ default: m[name] })));

const ChatRoute = lazyNamed(() => import('./routes/ChatRoute'), 'ChatRoute');
const AiMemorySettingsView = lazyNamed(() => import('./routes/AiMemorySettingsView'), 'AiMemorySettingsView');
const ProjectsView = lazyNamed(() => import('./routes/ProjectsView'), 'ProjectsView');
const ProjectDetail = lazyNamed(() => import('./routes/ProjectDetail'), 'ProjectDetail');
const ArtifactLibrary = lazyNamed(() => import('./routes/ArtifactLibrary'), 'ArtifactLibrary');
const ArtifactCreate = lazyNamed(() => import('./routes/ArtifactCreate'), 'ArtifactCreate');
const ArtifactEditor = lazyNamed(() => import('./routes/ArtifactEditor'), 'ArtifactEditor');
const CurriculumView = lazyNamed(() => import('./routes/CurriculumView'), 'CurriculumView');
const CurriculumLanding = lazyNamed(() => import('./routes/CurriculumLanding'), 'CurriculumLanding');
const MyClassView = lazyNamed(() => import('./routes/MyClassView'), 'MyClassView');
const MyClassStudentsView = lazyNamed(() => import('./routes/MyClassStudentsView'), 'MyClassStudentsView');
const ClassApprovalsView = lazyNamed(() => import('./routes/ClassApprovalsView'), 'ClassApprovalsView');
const ClassFinanceView = lazyNamed(() => import('./routes/ClassFinanceView'), 'ClassFinanceView');
const ClassTimetableView = lazyNamed(() => import('./routes/ClassTimetableView'), 'ClassTimetableView');
const AttendanceHomeView = lazyNamed(
  () => import('./features/attendance/routes/AttendanceHomeView'),
  'AttendanceHomeView',
);
const ClassLogsView = lazyNamed(() => import('./routes/ClassLogsView'), 'ClassLogsView');
const ReportsView = lazyNamed(() => import('./routes/ReportsView'), 'ReportsView');
const TimetableView = lazyNamed(() => import('./routes/TimetableView'), 'TimetableView');
const WorkloadView = lazyNamed(() => import('./routes/WorkloadView'), 'WorkloadView');
const AssessmentsView = lazyNamed(() => import('./routes/AssessmentsView'), 'AssessmentsView');
const DocumentsView = lazyNamed(() => import('./features/documents/routes/DocumentsView'), 'DocumentsView');
const CalendarView = lazyNamed(() => import('./routes/CalendarView'), 'CalendarView');
const DepartmentOverview = lazyNamed(() => import('./routes/DepartmentOverview'), 'DepartmentOverview');
const DepartmentClassesView = lazyNamed(() => import('./routes/DepartmentClassesView'), 'DepartmentClassesView');
const DepartmentFacultyView = lazyNamed(() => import('./routes/DepartmentFacultyView'), 'DepartmentFacultyView');
const DepartmentStudentsView = lazyNamed(() => import('./routes/DepartmentStudentsView'), 'DepartmentStudentsView');
const DepartmentPromotionsView = lazyNamed(
  () => import('./routes/DepartmentPromotionsView'),
  'DepartmentPromotionsView',
);
const DepartmentApprovalsView = lazyNamed(() => import('./routes/DepartmentApprovalsView'), 'DepartmentApprovalsView');
const DepartmentTimetableView = lazyNamed(() => import('./routes/DepartmentTimetableView'), 'DepartmentTimetableView');
const InstitutionOverview = lazyNamed(() => import('./routes/InstitutionOverview'), 'InstitutionOverview');
const InstitutionDepartmentsView = lazyNamed(
  () => import('./routes/InstitutionDepartmentsView'),
  'InstitutionDepartmentsView',
);
const InstitutionFacultyView = lazyNamed(() => import('./routes/InstitutionFacultyView'), 'InstitutionFacultyView');
const InstitutionStudentsView = lazyNamed(() => import('./routes/InstitutionStudentsView'), 'InstitutionStudentsView');
const InstitutionApprovalsView = lazyNamed(
  () => import('./routes/InstitutionApprovalsView'),
  'InstitutionApprovalsView',
);
const InstitutionTimetableView = lazyNamed(
  () => import('./routes/InstitutionTimetableView'),
  'InstitutionTimetableView',
);
const InstitutionAiSettingsView = lazyNamed(
  () => import('./routes/InstitutionAiSettingsView'),
  'InstitutionAiSettingsView',
);
const InstitutionAcademicYearView = lazyNamed(
  () => import('./routes/InstitutionAcademicYearView'),
  'InstitutionAcademicYearView',
);
const DelegatedOverview = lazyNamed(() => import('./routes/DelegatedOverview'), 'DelegatedOverview');
const DelegatedApprovalsView = lazyNamed(() => import('./routes/DelegatedApprovalsView'), 'DelegatedApprovalsView');
const DelegatedWorkAreasView = lazyNamed(() => import('./routes/DelegatedWorkAreaView'), 'DelegatedWorkAreasView');
const DelegatedWorkAreaDetail = lazyNamed(() => import('./routes/DelegatedWorkAreaView'), 'DelegatedWorkAreaDetail');

// P3 5.9 — attendance state moved from a context provider to a Zustand
// store, so this layout no longer wraps anything; it owns the section's
// lifecycle instead. useAttendanceLifecycle resets the store on entry
// (preserving the provider's own mount/unmount semantics, which this
// route tree relied on) and runs the 30s clock only while the section is
// mounted.
function AttendanceLayout() {
  useAttendanceLifecycle();
  return <Outlet />;
}

/**
 * Attendance actions have no page of their own any more — they all happen in
 * the workspace's right-side drawer. An old deep link to a single period
 * resolves to the same workspace with that period's drawer open, so the
 * sidebar and Today's schedule are never lost, and the drawer's own
 * ownership/acknowledgement checks still decide what it may show.
 */
function PeriodDeepLink() {
  const { periodId } = useParams();
  return <Navigate to={`/curriculum/attendance?period=${encodeURIComponent(periodId)}`} replace />;
}

export default function App() {
  return (
    /*
      Which academic term is running sits outermost, because both layers below
      it are facts *about* a term: the roster resolves students into the current
      term's classes, and the lifecycle provider composes the current term's
      seats and placements. A term held beside either of them would let a
      commencement change the class list while the roster was still filling the
      previous one.

      Until somebody commences a semester the term is generation 0 and every
      selector resolves the fixture arrays by identity, so nothing below this
      line behaves differently from before it existed.
    */
    <AcademicTermProvider>
      {/*
      The roster overlay sits above every route, not under the class ones. A
      student a Class Tutor admits is activated in the real active class roster,
      and the department and institution workspaces have to resolve that same
      record by that same id — holding new students under the L4 routes would
      rebuild the second-source-of-truth defect Phase 0 removed, and lose them
      on navigation besides.
    */}
      <AcademicRosterProvider>
        {/*
      Seats and semester-transition placements sit above every route for the
      same reason the roster does, and *inside* the roster because a confirmed
      promotion places its student through it. A Class Tutor seat reassigned in
      the department workspace is the seat L4's own workspace resolves and L1's
      readiness panel counts; a promoted student is on the target class's roster
      before anyone has navigated anywhere. Holding either under the department
      routes would make the department a second source of truth for facts the
      whole institution reads — and would lose them on navigation besides.
    */}
        <InstitutionalLifecycleProvider>
          <Suspense fallback={<Loading label="Loading…" />}>
            <Routes>
              <Route path="/login" element={<LoginPage />} />
              <Route element={<ProtectedRoute />}>
                <Route element={<AppShell />}>
                  <Route path="/" element={<HomeView />} />
                  <Route path="/chat/:chatId" element={<ChatRoute />} />
                  <Route path="/projects" element={<ProjectsView />} />
                  <Route path="/projects/:projectId" element={<ProjectDetail />} />
                  <Route path="/artifacts" element={<ArtifactLibrary />} />
                  <Route path="/artifacts/new" element={<ArtifactCreate />} />
                  <Route path="/artifacts/:artifactId" element={<ArtifactEditor />} />
                  <Route path="/ai-memory" element={<AiMemorySettingsView />} />
                  <Route path="/curriculum" element={<CurriculumLanding />} />
                  <Route path="/curriculum/attendance" element={<AttendanceLayout />}>
                    <Route element={<AttendanceTabsLayout />}>
                      <Route index element={<AttendanceHomeView />} />
                      <Route path="class-logs" element={<ClassLogsView />} />
                      <Route path="reports" element={<ReportsView />} />
                      <Route path="timetable" element={<TimetableView />} />
                      <Route path="workload" element={<WorkloadView />} />
                    </Route>
                    <Route path=":periodId" element={<PeriodDeepLink />} />
                  </Route>
                  <Route
                    path="/curriculum/assessments"
                    element={
                      <AssessmentsProvider>
                        <AssessmentsView />
                      </AssessmentsProvider>
                    }
                  />
                  {/*
          The Class Tutor seat's own destinations. Nested under /curriculum so
          the sidebar's Home/Curriculum mode sync in AppShell keeps working
          untouched — this is a different menu inside the same context, not a
          third context. The routes stay exactly here: `ClassGate` gives the
          seat the scope isolation `/department` and `/institution` already had,
          which is the objective — URL symmetry with them is not.
        */}
                  <Route path="/curriculum/my-class" element={<ClassGate />}>
                    <Route index element={<MyClassView />} />
                    <Route path="students" element={<MyClassStudentsView />} />
                    <Route path="approvals" element={<ClassApprovalsView />} />
                    <Route path="finance" element={<ClassFinanceView />} />
                    <Route path="timetable" element={<ClassTimetableView />} />
                  </Route>
                  <Route path="/curriculum/documents" element={<DocumentsView />} />
                  <Route path="/curriculum/calendar" element={<CalendarView />} />
                  <Route path="/curriculum/:section" element={<CurriculumView />} />
                  {/*
          The Head of Department seat's destinations, at their own top-level
          root rather than under /curriculum: this seat's scope is a whole
          department, not one class inside the curriculum menu's class-shaped
          world. `AppShell` and `SidebarNavigation` share one `isCurriculumPath`
          predicate so the sidebar still reads these as the Curriculum context.
        */}
                  <Route path="/department" element={<DepartmentGate />}>
                    <Route index element={<DepartmentOverview />} />
                    <Route path="classes" element={<DepartmentClassesView />} />
                    <Route path="faculty" element={<DepartmentFacultyView />} />
                    <Route path="students" element={<DepartmentStudentsView />} />
                    <Route path="promotions" element={<DepartmentPromotionsView />} />
                    <Route path="approvals" element={<DepartmentApprovalsView />} />
                    <Route path="timetable" element={<DepartmentTimetableView />} />
                  </Route>
                  {/*
          The Principal seat's destinations, at their own top-level root for the
          same reason `/department` has one: this seat's scope is the whole
          institution, not one department inside a department-shaped menu.
          `AppShell` and `SidebarNavigation` share one `isCurriculumPath`
          predicate, which now also reads these as the Curriculum context.
        */}
                  <Route path="/institution" element={<InstitutionGate />}>
                    <Route index element={<InstitutionOverview />} />
                    {/*
            The Academic Year is this seat's alone. No other workspace has a
            destination for it, because no other seat commences a term — a head
            of department reviews promotions *into* a term somebody else opened.
          */}
                    <Route path="academic-year" element={<InstitutionAcademicYearView />} />
                    <Route path="departments" element={<InstitutionDepartmentsView />} />
                    <Route path="faculty" element={<InstitutionFacultyView />} />
                    <Route path="students" element={<InstitutionStudentsView />} />
                    <Route path="approvals" element={<InstitutionApprovalsView />} />
                    <Route path="timetable" element={<InstitutionTimetableView />} />
                    <Route path="ai-settings" element={<InstitutionAiSettingsView />} />
                  </Route>
                  {/*
          The delegated seat's destinations, at their own scope-named root.
          `/delegated`, never `/dean` — what a college calls this seat is
          configuration, and a URL built from a configured title would be a
          different URL in every institution.

          **Registered from provisioning, and deliberately not redirected.** An
          institution with no delegated position gets a route that says so
          rather than one that bounces to `/`: a redirect would drop the user
          into whichever workspace they were already in, and for a personal
          Staff view that is exactly the delegated-to-Staff fallthrough this
          seat's absence must never produce. Occupancy is a separate question
          from existence and belongs to the gate — a configured seat nobody
          holds still has routes, and they say the seat is vacant.
        */}
                  {delegatedRegistered() ? (
                    <Route path="/delegated" element={<DelegatedGate />}>
                      <Route index element={<DelegatedOverview />} />
                      <Route path="approvals" element={<DelegatedApprovalsView />} />
                      <Route path="areas" element={<DelegatedWorkAreasView />} />
                      <Route path="areas/:areaId" element={<DelegatedWorkAreaDetail />} />
                      {/* An unknown path *inside* a delegated workspace that exists stays
                inside it. It is a wrong address in this seat's own space, not a
                seat that does not exist. */}
                      <Route path="*" element={<Navigate to="/delegated" replace />} />
                    </Route>
                  ) : (
                    <Route path="/delegated/*" element={<DelegatedNotConfigured />} />
                  )}
                  <Route path="*" element={<Navigate to="/" replace />} />
                </Route>
              </Route>
            </Routes>
          </Suspense>
        </InstitutionalLifecycleProvider>
      </AcademicRosterProvider>
    </AcademicTermProvider>
  );
}
