import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';

// Shell renders a neutral loading state while restoreSession() is still
// resolving, instead of flashing an unauthenticated redirect or a wrong
// role's chrome — see PHASE-B-PLAN-TANGLISH.md "safe render" rule.
export function ProtectedRoute() {
  const { isAuthenticated, sessionReady } = useAuth();
  const location = useLocation();

  if (!sessionReady) {
    return (
      <div className="flex h-screen items-center justify-center bg-frame text-ink-muted text-sm">
        Loading your session…
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }
  return <Outlet />;
}
