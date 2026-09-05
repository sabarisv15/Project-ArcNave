import { createRootRoute, createRoute, createRouter, Link, Outlet, useParams } from '@tanstack/react-router';

// P4 5.3 scaffold — proves TanStack Router genuinely works with this app's
// real Vite/React 19/Tailwind stack, with real type inference, before any
// production route is touched. See ADL-083 (bka/30-decisions/ledger.md)
// for what this is (and, just as importantly, is NOT) scoped to.
//
// Deliberately mounted as its own isolated island at /router-preview
// (registered in App.jsx alongside /login, outside ProtectedRoute) rather
// than replacing anything in the real route tree. Swapping the app's root
// provider from react-router-dom's <BrowserRouter> to TanStack's
// <RouterProvider> would break every one of the ~140 existing
// useNavigate/useParams/useLocation/Link call-sites app-wide the instant
// it happened, regardless of which routes were "migrated" yet — those
// hooks throw outside a react-router <Router> context. Running both
// routers against the same browser History object at once is also not a
// supported, verified-safe pattern (each independently owns
// pushState/popstate). Neither risk is worth taking on inside a single
// scaffolding pass — the real cutover strategy is the next, separately
// scoped decision, not assumed here.

function RootLayout() {
  return (
    <div className="min-h-screen bg-frame px-[24px] py-[20px] font-sans text-ink-soft">
      <div className="max-w-[640px] mx-auto bg-paper border border-line rounded-[16px] p-[20px] shadow-card">
        <p className="text-[11px] font-[600] tracking-[.04em] text-ink-faint uppercase mb-[4px]">
          P4 5.3 — TanStack Router scaffold
        </p>
        <h1 className="text-[19px] font-[700] text-ink mb-[12px]">Router preview</h1>
        <Outlet />
      </div>
    </div>
  );
}

function PreviewIndex() {
  return (
    <div>
      <p className="text-[13px] text-ink-muted mb-[12px]">
        A real, type-safe route tree — this page and the one it links to are both genuine TanStack Router routes,
        compiled by the same Vite config the rest of ArcNave uses.
      </p>
      {/* `to`/`params` here are checked against the route tree's own types at
          compile time — a typo in either would be a real tsc error, not a
          runtime 404 discovered later. */}
      <Link
        to="/students/$studentId"
        params={{ studentId: 'demo-001' }}
        className="inline-flex items-center h-[32px] px-[13px] rounded-[9px] bg-accent text-white text-[12.5px] font-[500] no-underline hover:bg-accent-hover"
      >
        Open a typed student route →
      </Link>
    </div>
  );
}

function PreviewStudent() {
  // Typed by the route tree: `studentId` is known to exist and be a string
  // here — no manual parsing, no `useParams()` cast, no possibility of
  // reading a param this route never declared.
  const { studentId } = useParams({ from: studentRoute.id });
  return (
    <div>
      <p className="text-[13px] text-ink-muted mb-[12px]">
        <code className="px-[5px] py-[1px] rounded-[5px] bg-surface text-ink-soft">studentId</code> resolved from the
        URL, typed end to end: <strong className="text-ink">{studentId}</strong>
      </p>
      <Link to="/" className="text-[12.5px] font-[500] text-accent hover:text-accent-hover">
        ← Back
      </Link>
    </div>
  );
}

const rootRoute = createRootRoute({ component: RootLayout });

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  component: PreviewIndex,
});

const studentRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/students/$studentId',
  component: PreviewStudent,
});

const routeTree = rootRoute.addChildren([indexRoute, studentRoute]);

export const previewRouter = createRouter({ routeTree, basepath: '/router-preview' });

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof previewRouter;
  }
}
