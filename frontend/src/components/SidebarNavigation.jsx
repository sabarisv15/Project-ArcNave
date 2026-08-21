import { NavLink, useLocation } from 'react-router-dom';
import {
  ArrowUpRight,
  BrainCircuit,
  BriefcaseBusiness,
  Building,
  Building2,
  CalendarClock,
  CalendarDays,
  CalendarRange,
  ClipboardCheck,
  FileCheck2,
  Files,
  FolderKanban,
  Globe,
  GraduationCap,
  Landmark,
  LayoutDashboard,
  Layers,
  SquarePen,
  Wallet,
} from 'lucide-react';
import { navIconClass, navItemClass } from '../lib/navItemStyles';
import { StudentNavCountBadge } from './StudentNavCountBadge';
import { StaffNavCountBadge } from './StaffNavCountBadge';
import { useWorkspace } from '../store/WorkspaceProvider';
import { CLASS_TUTOR_L4, HOD_L3, LEVEL_2, PRINCIPAL_L1, TEACHING_STAFF } from '../lib/roles';
import { delegatedNavItems, delegatedScope } from '../lib/delegatedScope';

const HOME_NAV = [
  { to: '/', label: 'New', Icon: SquarePen, end: true },
  { to: '/projects', label: 'Projects', Icon: FolderKanban },
  { to: '/artifacts', label: 'Artifacts', Icon: Files },
  { to: '/ai-memory', label: 'AI Memory', Icon: BrainCircuit },
];

const STAFF_CURRICULUM_NAV = [
  { to: '/curriculum/students', label: 'Students', Icon: GraduationCap, CountBadge: StudentNavCountBadge },
  { to: '/curriculum/staff', label: 'Staff', Icon: BriefcaseBusiness, CountBadge: StaffNavCountBadge },
  { to: '/curriculum/attendance', label: 'Attendance & Class log', Icon: ClipboardCheck },
  { to: '/curriculum/assessments', label: 'Assessments', Icon: FileCheck2 },
  { to: '/curriculum/documents', label: 'Documents', Icon: Files },
  { to: '/curriculum/calendar', label: 'Calendar', Icon: CalendarDays },
];

/**
 * The Class Tutor seat's own menu. Not the staff list with items hidden — a
 * different set of destinations for a different job, scoped to the one class
 * this seat owns.
 *
 * Documents and Calendar are the shared destinations both seats use, pointed at
 * the same routes rather than duplicated. Examinations and Reports are
 * deliberately absent: those screens are not built yet, and a menu entry for a
 * destination that does not exist is a dead link, not a preview.
 */
const CLASS_TUTOR_CURRICULUM_NAV = [
  { to: '/curriculum/my-class', label: 'My Class', Icon: LayoutDashboard, end: true },
  { to: '/curriculum/my-class/students', label: 'Students', Icon: GraduationCap },
  { to: '/curriculum/my-class/approvals', label: 'Approvals', Icon: ClipboardCheck },
  { to: '/curriculum/my-class/finance', label: 'Finance & scholarships', Icon: Wallet },
  { to: '/curriculum/my-class/timetable', label: 'Timetable', Icon: CalendarClock },
  { to: '/curriculum/documents', label: 'Documents', Icon: Files },
  { to: '/curriculum/calendar', label: 'Calendar', Icon: CalendarDays },
];

/**
 * The Head of Department seat's menu.
 *
 * Department-first, in the order the seat actually works: the department as a
 * whole, then the three populations it monitors, then the two things it decides
 * on. It is not the tutor menu widened — there is no My Class, no Finance and
 * no attendance-marking destination, because an HOD does not mark a register.
 *
 * Documents and Calendar are the shared, role-agnostic destinations all three
 * seats use, pointed at the same existing routes rather than duplicated.
 * Finance, Examinations, Reports and Alerts are deliberately absent: those
 * screens are not built for this seat, and a menu entry for a destination that
 * does not exist is a dead link, not a preview.
 */
const HOD_CURRICULUM_NAV = [
  { to: '/department', label: 'Department', Icon: Building2, end: true },
  { to: '/department/classes', label: 'Classes', Icon: Layers },
  { to: '/department/faculty', label: 'Faculty', Icon: BriefcaseBusiness },
  { to: '/department/students', label: 'Students', Icon: GraduationCap },
  // Sits beside Students because it is about the same people, and above
  // Approvals because it is a decision this seat owns outright rather than one
  // passed to it. It appears only now that its route exists — a menu item
  // pointing at an unbuilt destination is a dead link, not a preview.
  { to: '/department/promotions', label: 'Promotions', Icon: ArrowUpRight },
  { to: '/department/approvals', label: 'Approvals', Icon: ClipboardCheck },
  { to: '/department/timetable', label: 'Timetable', Icon: CalendarClock },
  { to: '/curriculum/documents', label: 'Documents', Icon: Files },
  { to: '/curriculum/calendar', label: 'Calendar', Icon: CalendarDays },
];

/**
 * The Principal seat's menu.
 *
 * Institution-first, and deliberately **not the HOD menu widened**. The two
 * read similarly because both are oversight seats, but what sits behind each
 * item differs in kind: Departments is a comparison across six departments, not
 * a list of classes; Approvals holds only what an HOD has already endorsed and
 * passed upward, or what no single department can settle; Timetable is
 * cross-department exceptions rather than one department's grid.
 *
 * `Building` rather than `Building2` on the root, because `Building2` is the
 * HOD menu's Department icon and two seats' landing items should not be
 * indistinguishable at a glance.
 *
 * Documents and Calendar are the shared, role-agnostic destinations all four
 * seats use, pointed at the same existing routes rather than duplicated.
 * Finance, Examinations, Reports, Alerts and Settings are deliberately absent:
 * those screens are not built for this seat, and a menu entry for a destination
 * that does not exist is a dead link, not a preview.
 */
const PRINCIPAL_CURRICULUM_NAV = [
  { to: '/institution', label: 'Institution', Icon: Building, end: true },
  // Sits directly under the root because the term is the frame every other item
  // is read inside — which classes are running, which seats derive from them and
  // which timetables matter are all facts about it. It appears only now that its
  // route exists; a menu item pointing at an unbuilt destination is a dead link,
  // not a preview.
  { to: '/institution/academic-year', label: 'Academic Year', Icon: CalendarRange },
  { to: '/institution/departments', label: 'Departments', Icon: Building2 },
  { to: '/institution/faculty', label: 'Faculty', Icon: BriefcaseBusiness },
  { to: '/institution/students', label: 'Students', Icon: GraduationCap },
  { to: '/institution/approvals', label: 'Approvals', Icon: ClipboardCheck },
  { to: '/institution/timetable', label: 'Timetable', Icon: CalendarClock },
  { to: '/institution/ai-settings', label: 'AI Browsing', Icon: Globe },
  { to: '/curriculum/documents', label: 'Documents', Icon: Files },
  { to: '/curriculum/calendar', label: 'Calendar', Icon: CalendarDays },
];

/**
 * Whether a path belongs to the Curriculum context.
 *
 * The HOD and Principal seats' destinations live at their own top-level
 * `/department` and `/institution` roots rather than under `/curriculum`, so
 * "is this a Curriculum route" can no longer be a single `startsWith`. Both the
 * sidebar's selection logic and `AppShell`'s route→mode sync read this one
 * predicate, so the menu that renders and the item that lights up can never
 * disagree about where the user is.
 */
export function isCurriculumPath(pathname) {
  return (
    pathname.startsWith('/curriculum') ||
    pathname.startsWith('/department') ||
    pathname.startsWith('/institution') ||
    pathname.startsWith('/delegated')
  );
}

const DELEGATED_ICONS = {
  overview: Landmark,
  approvals: ClipboardCheck,
  areas: Layers,
  documents: Files,
  calendar: CalendarDays,
};

/**
 * The delegated seat's menu — **built, not listed.**
 *
 * Every other menu in this file is a constant because every other seat is a
 * fixed shape: a class tutor's destinations are the same in any college. A
 * delegated seat is not a fixed shape. What it covers, whether it sits in an
 * approval chain and which work areas it carries are provisioned per
 * institution, so its menu is derived from that configuration — and a college
 * that delegated no work areas gets an Overview and the shared destinations
 * rather than rows pointing at work it does not have.
 */
function delegatedCurriculumNav() {
  return delegatedNavItems(delegatedScope()).map((item) => ({
    to: item.to,
    label: item.label,
    end: item.end,
    Icon: DELEGATED_ICONS[item.kind] ?? Layers,
  }));
}

/**
 * Which menu a seat gets — an explicit table, deliberately not a chain of
 * ternaries with a default.
 *
 * **The default was the defect.** `role === CLASS_TUTOR_L4 ? … : STAFF_NAV`
 * meant any seat this function had not been taught about resolved to the
 * personal Staff menu, and the delegated seat was exactly such a seat: selecting
 * it produced Staff navigation over a Staff scope, which is not a lesser version
 * of a delegated workspace but a different institutional context wearing its
 * name. A table has no fallthrough — a seat with no entry gets no items, and an
 * empty menu is a visible bug rather than a silent impersonation of another
 * seat.
 *
 * The delegated entry resolves to `[]` in an institution provisioned without
 * that seat. Unreachable in practice, because no switcher entry exists there to
 * select — and the correct answer regardless.
 */
export function curriculumNavFor(role) {
  switch (role) {
    case PRINCIPAL_L1:
      return PRINCIPAL_CURRICULUM_NAV;
    case LEVEL_2:
      return delegatedCurriculumNav();
    case HOD_L3:
      return HOD_CURRICULUM_NAV;
    case CLASS_TUTOR_L4:
      return CLASS_TUTOR_CURRICULUM_NAV;
    case TEACHING_STAFF:
      return STAFF_CURRICULUM_NAV;
    default:
      return [];
  }
}

function Row({ to, label, Icon, end, isActive, CountBadge, settleKey }) {
  return (
    <NavLink
      to={to}
      end={end}
      aria-current={isActive ? 'page' : undefined}
      // Selection comes from `activeFor` below, which understands sub-routes;
      // NavLink's own `isActive` is deliberately ignored so the two can never
      // disagree and leave a stale highlight behind.
      className={() => navItemClass(isActive)}
    >
      {/*
        Keyed by the route that made this row active, so the 200ms settle
        replays on each navigation *into* the item and then holds still — a
        `both`-filled animation on a stable element would otherwise play once
        per mount and never again. The row that just lost selection simply
        drops the class and returns to rest.
      */}
      <Icon
        key={isActive ? settleKey : 'rest'}
        size={18}
        strokeWidth={1.75}
        aria-hidden="true"
        className={navIconClass(isActive)}
      />
      <span>{label}</span>
      {CountBadge && <CountBadge active={isActive} />}
    </NavLink>
  );
}

/**
 * One continuous navigation group — equal-weight rows, no cards, no
 * sections. `mode` (which item list renders) is owned by `Sidebar`, not
 * derived from the route, so the Curriculum toggle can swap the list
 * without navigating.
 */
export function SidebarNavigation({ mode }) {
  const { pathname } = useLocation();
  const { activeRole } = useWorkspace();
  const isCurriculum = mode === 'curriculum';
  const items = isCurriculum ? curriculumNavFor(activeRole) : HOME_NAV;

  const onCurriculumRoute = isCurriculumPath(pathname);

  const activeFor = (item) => {
    if (isCurriculum) {
      // Switching the *menu* to Curriculum while a Home-side page is still
      // open must highlight nothing: the sidebar changed, the route did not.
      if (!onCurriculumRoute) return false;
      // A section that is itself the parent of other menu items (My Class,
      // whose Students/Approvals/Finance/Timetable are siblings in this same
      // list) marks itself `end` so it lights up only on its own route —
      // otherwise it would stay lit alongside whichever child is open.
      if (item.end) return pathname === item.to;
      // Sections with their own sub-routes (Attendance & Class log's tabs, a
      // period's drawer deep link) still count as "open" here.
      return pathname === item.to || pathname.startsWith(`${item.to}/`);
    }
    // The mirror of the above: a Curriculum route never lights up a Home item.
    if (onCurriculumRoute) return false;
    if (item.to === '/') return pathname === '/' || pathname.startsWith('/chat');
    return pathname.startsWith(item.to);
  };

  return (
    <nav aria-label={isCurriculum ? 'Curriculum navigation' : 'Home navigation'} className="flex flex-col gap-[1px]">
      {items.map((item) => (
        <Row key={item.to} {...item} isActive={activeFor(item)} settleKey={pathname} />
      ))}
    </nav>
  );
}
