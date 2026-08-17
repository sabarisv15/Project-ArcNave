import React, { useEffect, useRef } from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from 'next-themes';
import { Toaster } from 'sonner';
import * as Tooltip from '@radix-ui/react-tooltip';
import App from './App.jsx';
import { AuthProvider, useAuth } from '@/hooks/useAuth';
import { WorkspaceProvider } from './store/WorkspaceProvider.jsx';
import { ComposerProvider } from './store/ComposerProvider.jsx';
import { startAutoHideScrollbars } from './lib/autoHideScrollbars.js';
import './index.css';

startAutoHideScrollbars();

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: Infinity, refetchOnWindowFocus: false } },
});

// Restores the real session (JWT refresh) once on boot, before any route
// renders. Refresh tokens are single-use server-side (rotate-on-use), so a
// second concurrent call with the same stored token races the first and
// 401s — React 18 StrictMode double-invokes this effect in dev, so the
// hasRun guard is required, not optional (confirmed against the real
// backend: without it, every reload had a ~50% chance of silently losing
// the session a moment after login).
function AuthBootstrap({ children }) {
  const { restoreSession } = useAuth();
  const hasRun = useRef(false);
  useEffect(() => {
    if (hasRun.current) return;
    hasRun.current = true;
    restoreSession();
  }, [restoreSession]);
  return children;
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ThemeProvider attribute="class" defaultTheme="light" enableSystem={false}>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <AuthBootstrap>
            <BrowserRouter>
              <Tooltip.Provider delayDuration={250}>
                <WorkspaceProvider>
                  <ComposerProvider>
                    <App />
                  </ComposerProvider>
                  <Toaster
                    position="bottom-right"
                    offset={22}
                    style={{ zIndex: 200 }}
                    toastOptions={{
                      style: {
                        background: 'rgb(var(--c-ink-soft))',
                        color: 'rgb(var(--c-paper))',
                        border: 'none',
                        borderRadius: '12px',
                        fontSize: '12.5px',
                        fontFamily: '"DM Sans", Inter, sans-serif',
                      },
                    }}
                  />
                </WorkspaceProvider>
              </Tooltip.Provider>
            </BrowserRouter>
          </AuthBootstrap>
        </AuthProvider>
      </QueryClientProvider>
    </ThemeProvider>
  </React.StrictMode>
);
